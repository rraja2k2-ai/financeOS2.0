/**
 * Capture Inbox service (C5, finalized against the frozen capture_queue schema) — the
 * queue/orchestration layer between Capture and Save.
 *
 * Lifecycle:
 *   enqueueCapture()   upload pages to Storage + insert a queue row (status=Processing,
 *                      retry_count=0, transaction_header_id=null)
 *   processQueueItem() runs in the background (Next's after()); for the item's stored
 *                      pages + context, runs the EXISTING AI pipeline:
 *                        success → status=Ready for Review, result_json, merchant, ai_provider
 *                        failure → status=Failed, error_message, retry_count += 1
 *                      Pages are never touched/removed on failure — the receipt is never lost.
 *   retryQueueItem()   Failed → Processing, retry_count += 1, error_message=null, then the
 *                      SAME processQueueItem() runs again — no duplicated processing logic.
 *   (save)             services/capture/save-capture.service.ts (unchanged) persists the
 *                      transaction; the caller then marks this row status=Saved and sets
 *                      transaction_header_id — pages/result_json/merchant are left as-is.
 *   deleteQueueItem()  removes only the queue row (+ its Storage files, UNLESS the item is
 *                      already Saved, since a saved transaction's receipt_attachments then
 *                      references those same Storage paths). Never touches transaction_headers.
 *
 * Reuses the existing pipeline pieces untouched: master-data.service, capture.service
 * (processCapture), the provider factory, and the Storage repository. No transaction
 * tables are written here — the queue is completely independent from Activity.
 */
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/config/supabase";
import * as captureQueueRepository from "@/repositories/capture-queue.repository";
import * as receiptStorageRepository from "@/repositories/receipt-storage.repository";
import { RECEIPTS_BUCKET } from "@/repositories/receipt-storage.repository";
import { loadCaptureMasterData } from "./master-data.service";
import { processCapture } from "./capture.service";
import { getActiveCaptureProviderName } from "@/services/ai/providers";
import { friendlyCaptureError, type CaptureDocumentPage, type CaptureReceiptResult } from "@/services/ai/ai-provider";
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
 * The background step: runs the EXISTING AI pipeline against the stored pages + context
 * and records the outcome on the queue row. Never throws — a failure becomes status
 * 'Failed' with a friendly message so the receipt is never lost. Writes only the fields
 * that changed (no full-row rewrites).
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

    await captureQueueRepository.update(supabase, queueId, {
      status: "Ready for Review",
      result_json: result,
      merchant: result.header.merchant,
      ai_provider: getActiveCaptureProviderName(),
    });
  } catch (err) {
    console.error(`[inbox] processing failed for ${queueId}:`, err);
    // Re-fetch: retry_count may have changed since we first loaded the row (e.g. a
    // concurrent retry click), so increment off the latest known value, not a stale one.
    const latest = await captureQueueRepository.getById(supabase, queueId).catch(() => row);
    const nextRetryCount = (latest ?? row).retry_count + 1;
    // The row may have been deleted mid-run — ignore update failures.
    await captureQueueRepository
      .update(supabase, queueId, { status: "Failed", error_message: friendlyCaptureError(err), retry_count: nextRetryCount })
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
 * Removes the queue row. Storage files are removed too — UNLESS the capture was already
 * Saved, in which case the saved transaction's receipt_attachments rows reference those
 * same paths, so deleting them would corrupt the permanent record. Never touches
 * transaction_headers/transaction_items — deleting a queue record never deletes a
 * transaction.
 */
export async function deleteQueueItem(supabase: SupabaseClient, queueId: string): Promise<void> {
  const row = await captureQueueRepository.getById(supabase, queueId);
  if (!row) return;

  if (row.status !== "Saved") {
    await receiptStorageRepository.removeReceiptPages(supabase, row.pages.map((p) => p.storagePath)).catch(() => {});
  }
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
  transactionHeaderId: string | null;
  resultJson: CaptureReceiptResult | null;
};

/** All queue items (every status, including Saved — the Inbox displays all of them). */
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
    resultJson: row.status === "Ready for Review" ? (row.result_json as CaptureReceiptResult) : null,
  }));
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
