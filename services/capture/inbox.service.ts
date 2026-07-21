/**
 * Capture Inbox service — the queue/orchestration layer between Capture and Save.
 *
 * Fix 5.1: capture_queue is a TRANSIENT PROCESSING QUEUE, not a history table. Activity
 * is the permanent transaction history; a queue row's job ends the moment its capture
 * either becomes a transaction or needs a retry.
 *
 * Lifecycle:
 *   enqueueCapture()   upload pages to Storage + insert a queue row (status=Processing,
 *                      retry_count=0)
 *   processQueueItem() runs in the background (Next's after()); for the item's stored
 *                      pages + context, runs the EXISTING AI pipeline, and if it returns a
 *                      result, saves it IMMEDIATELY via the EXISTING Save flow — no
 *                      eligibility check, no confidence threshold, no account-resolution
 *                      gate, no manual Review step:
 *                        success → transaction + receipt_attachments persisted, then the
 *                          row's transaction_header_id is set to the EXACT id just created
 *                          (status stays Processing — no new status value) so whichever
 *                          poller sees it (Capture Modal or the global Inbox indicator)
 *                          can navigate by that exact id, never a "latest transaction"
 *                          guess (Fix 6.4.4). consumeSavedCapture() then removes the row.
 *                        failure (AI call OR the save itself) → status=Failed, error_message,
 *                          retry_count += 1 — the row stays for retry, pages untouched
 *   retryQueueItem()   Failed → Processing, retry_count += 1, error_message=null, then the
 *                      SAME processQueueItem() runs again — no duplicated processing logic.
 *   consumeSavedCapture() metadata-only removal of an already-SAVED row (transaction_header_id
 *                      set) — never touches Storage, since those files now belong to the
 *                      transaction's receipt_attachments. Called by whichever poller (Modal
 *                      or Inbox indicator) first reads the id, AND by deleteQueueItem below
 *                      when a user manually deletes a row in that same state.
 *   deleteQueueItem()  user-initiated delete from the Inbox. Delegates to consumeSavedCapture
 *                      (no Storage touched) if transaction_header_id is already set — that
 *                      row is an already-successful capture, no matter how "stuck" it looks
 *                      in the Inbox. Otherwise (genuinely Processing-in-flight or Failed,
 *                      never linked to a transaction) removes the queue row AND its Storage
 *                      files. Never touches transaction_headers either way.
 *
 * Reuses the existing pipeline pieces untouched: master-data.service, capture.service
 * (processCapture), save-capture.service (saveReviewedCapture, unmodified), the provider
 * factory, and the Storage repository. The Review Screen component itself is untouched —
 * no code path in the capture flow renders it; it is reachable only from Activity's Edit
 * action.
 */
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { getSupabaseConfig } from "@/config/supabase";
import * as captureQueueRepository from "@/repositories/capture-queue.repository";
import * as receiptStorageRepository from "@/repositories/receipt-storage.repository";
import { RECEIPTS_BUCKET } from "@/repositories/receipt-storage.repository";
import { loadCaptureMasterData } from "./master-data.service";
import { processCapture } from "./capture.service";
import { saveReviewedCapture, SaveValidationError } from "./save-capture.service";
import { reviewedFromResult } from "./reviewed-from-result";
import { getActiveCaptureProviderName } from "@/services/ai/providers";
import { friendlyCaptureError, type CaptureDocumentPage } from "@/services/ai/ai-provider";
import type { CaptureQueueItem, CaptureQueuePage, CaptureQueueStatus, CaptureSourceKind } from "@/domain/capture-queue";
import { receiptFolder, extForMime } from "./receipt-path";

/**
 * Background work (inside after()) runs outside a request, where the cookie-bound server
 * client isn't available — use a plain anon-key client instead.
 */
export function createBackgroundSupabaseClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseConfig();
  return createClient(url, anonKey);
}

/** Uploads the pages and creates the queue row. On any failure nothing is left behind. */
export async function enqueueCapture(
  supabase: SupabaseClient,
  input: { userContext: string; pages: CaptureDocumentPage[]; source: CaptureSourceKind }
): Promise<CaptureQueueItem> {
  const folder = receiptFolder();

  const queuePages: CaptureQueuePage[] = [];
  try {
    for (let i = 0; i < input.pages.length; i++) {
      const page = input.pages[i];
      const pageNo = i + 1;
      const path = `${folder}/page-${pageNo}${extForMime(page.mimeType)}`;
      const bytes = Buffer.from(page.dataBase64, "base64");
      const uploaded = await receiptStorageRepository.uploadReceiptPage(supabase, path, bytes, page.mimeType);
      queuePages.push({ ...uploaded, pageNo });
    }

    return await captureQueueRepository.insert(supabase, {
      status: "Processing",
      user_context: input.userContext,
      pages: queuePages,
      result_json: null,
      error_message: null,
      merchant: null,
      capture_source: input.source,
      ai_provider: null,
      transaction_header_id: null,
      retry_count: 0,
    });
  } catch (err) {
    await receiptStorageRepository.removeReceiptPages(supabase, queuePages.map((p) => p.storagePath)).catch(() => {});
    throw err;
  }
}

/**
 * The background step: runs the EXISTING AI pipeline against the stored pages + context,
 * then — if it returns a result — saves it IMMEDIATELY via the EXISTING Save flow and
 * records the created transaction's exact id on the queue row (Fix 6.4.4), which a
 * client then consumes and clears (Fix 5.1 — the queue never keeps a visibly "Saved"
 * row; Activity is the permanent record). No eligibility logic: if the AI successfully
 * returns a transaction, it gets saved; if anything in that chain throws (the AI call,
 * or the save itself), the item becomes Failed with a friendly message so the receipt is
 * never lost and the user can retry.
 */
export async function processQueueItem(queueId: string): Promise<void> {
  const supabase = createBackgroundSupabaseClient();

  let row: CaptureQueueItem | null = null;
  try {
    row = await captureQueueRepository.getById(supabase, queueId);
  } catch (err) {
    console.error(`[inbox] could not load queue item ${queueId}:`, err);
    return;
  }
  if (!row) return; // deleted while queued — nothing to do

  try {
    const pages = await downloadQueuePages(supabase, row.pages);
    const masterData = await loadCaptureMasterData(supabase);
    const result = await processCapture({ userContext: row.user_context, pages, masterData });

    const { headerId } = await saveReviewedCapture(supabase, {
      reviewed: reviewedFromResult(result),
      aiContext: row.user_context,
      pages: [],
      preUploadedPages: [...row.pages]
        .sort((a, b) => a.pageNo - b.pageNo)
        .map((p) => ({ storagePath: p.storagePath, mimeType: p.mimeType, fileSizeBytes: p.fileSizeBytes })),
      audit: { aiProvider: getActiveCaptureProviderName(), processedAt: row.updated_at, captureSource: row.capture_source },
    });

    // Saved — record the EXACT transaction_header.id this capture became (Fix 6.4.4), so
    // navigation never has to guess via "latest transaction." Status stays Processing (no
    // new status value written — CLAUDE.md §5); the row itself is removed by whichever
    // poller reads this id first, via consumeSavedCapture().
    await captureQueueRepository.update(supabase, queueId, { transaction_header_id: headerId });

    revalidatePath("/activity");
    revalidatePath("/");
  } catch (err) {
    console.error(`[inbox] processing failed for ${queueId}:`, err);
    // Re-fetch: retry_count may have changed since we first loaded the row (e.g. a
    // concurrent retry click), so increment off the latest known value, not a stale one.
    const latest = await captureQueueRepository.getById(supabase, queueId).catch(() => row);
    const nextRetryCount = (latest ?? row).retry_count + 1;
    // SaveValidationError already carries a specific, user-actionable message (e.g. "No
    // exchange rate on file for JPY...") — friendlyCaptureError only knows AI-side errors
    // and would otherwise flatten it to a generic one.
    const message = err instanceof SaveValidationError ? err.message : friendlyCaptureError(err);
    // The row may have been deleted mid-run — ignore update failures.
    await captureQueueRepository
      .update(supabase, queueId, { status: "Failed", error_message: message, retry_count: nextRetryCount })
      .catch(() => {});
  }
}

/**
 * Failed → Processing again, reusing the ORIGINAL stored receipt pages + context — the
 * user is never asked to upload anything again. Reruns the exact same background
 * pipeline (processQueueItem), never a duplicate implementation.
 */
export async function retryQueueItem(supabase: SupabaseClient, queueId: string): Promise<void> {
  const row = await captureQueueRepository.getById(supabase, queueId);
  if (!row) throw new Error("This capture no longer exists.");
  if (row.status !== "Failed") throw new Error("Only failed captures can be retried.");

  await captureQueueRepository.update(supabase, queueId, {
    status: "Processing",
    retry_count: row.retry_count + 1,
    error_message: null,
  });
}

/**
 * Metadata-only removal for a row whose transaction_header_id is already set (Fix 6.4.4)
 * — its Storage files now belong to the saved transaction's receipt_attachments and must
 * never be touched, whether this runs from a poller's automatic pickup or a user's manual
 * Delete on the Inbox page (deleteQueueItem routes here for exactly that reason). A no-op
 * if another caller already consumed (and thus deleted) the row first.
 */
export async function consumeSavedCapture(supabase: SupabaseClient, queueId: string): Promise<void> {
  await captureQueueRepository.remove(supabase, queueId).catch(() => {});
}

/**
 * User-initiated delete from the Capture Inbox (any status shown there is fair game to
 * dismiss). A row with `transaction_header_id` already set (Fix 6.4.4) is an already-
 * successful capture just waiting to be consumed — never Storage-eligible, no matter how
 * it's dismissed, since its files are now referenced by the saved transaction's
 * receipt_attachments. That case defers to consumeSavedCapture (metadata-only). Only a
 * genuinely Processing-in-flight or Failed row — never linked to a transaction — has its
 * Storage files removed here. Never touches transaction_headers/transaction_items either
 * way — deleting a queue record never deletes a transaction.
 */
export async function deleteQueueItem(supabase: SupabaseClient, queueId: string): Promise<void> {
  const row = await captureQueueRepository.getById(supabase, queueId);
  if (!row) return;

  if (row.transaction_header_id) {
    await consumeSavedCapture(supabase, queueId);
    return;
  }

  await receiptStorageRepository.removeReceiptPages(supabase, row.pages.map((p) => p.storagePath)).catch(() => {});
  await captureQueueRepository.remove(supabase, queueId);
}

/** Display-ready Inbox item — status is the literal DB value, the single source of truth. */
export type InboxItem = {
  id: string;
  status: CaptureQueueStatus;
  merchant: string | null;
  contextSnippet: string;
  capturedAt: string;
  updatedAt: string;
  errorMessage: string | null;
  retryCount: number;
  pageCount: number;
  firstPage: CaptureQueuePage | null;
  aiProvider: string | null;
  captureSource: string;
  /** Set once Save succeeds (Fix 6.4.4) — the exact transaction_headers.id this capture
   *  became, present only in the brief window before a client consumes the row. */
  transactionHeaderId: string | null;
};

/** Every queue row — Processing (in flight, or just-saved and awaiting pickup) or Failed
 *  (waiting on retry). Nothing else lingers here. */
export async function listInboxItems(supabase: SupabaseClient): Promise<InboxItem[]> {
  const rows = await captureQueueRepository.list(supabase);

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    merchant: row.merchant,
    contextSnippet: row.user_context.trim().slice(0, 80),
    capturedAt: row.created_at,
    updatedAt: row.updated_at,
    errorMessage: row.status === "Failed" ? row.error_message : null,
    retryCount: row.retry_count,
    pageCount: row.pages.length,
    firstPage: row.pages[0] ?? null,
    aiProvider: row.ai_provider,
    captureSource: row.capture_source,
    transactionHeaderId: row.transaction_header_id,
  }));
}

/** Display-ready status for ONE queue row — polled by the Capture screen (Fix 6.4A)
 *  while its own just-submitted capture is processing, so it can stay open and react the
 *  moment the item succeeds (transactionHeaderId set, Fix 6.4.4) or fails, instead of
 *  closing blind after upload or guessing at a "latest transaction." */
export type InboxItemStatus = {
  status: CaptureQueueStatus;
  errorMessage: string | null;
  transactionHeaderId: string | null;
};

export async function getInboxItemStatus(supabase: SupabaseClient, queueId: string): Promise<InboxItemStatus | null> {
  const row = await captureQueueRepository.getById(supabase, queueId);
  if (!row) return null;
  return { status: row.status, errorMessage: row.status === "Failed" ? row.error_message : null, transactionHeaderId: row.transaction_header_id };
}

async function downloadQueuePages(supabase: SupabaseClient, pages: CaptureQueuePage[]): Promise<CaptureDocumentPage[]> {
  const result: CaptureDocumentPage[] = [];
  for (const page of [...pages].sort((a, b) => a.pageNo - b.pageNo)) {
    const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).download(page.storagePath);
    if (error) throw error;
    result.push({ mimeType: page.mimeType, dataBase64: Buffer.from(await data.arrayBuffer()).toString("base64") });
  }
  return result;
}
