/**
 * Save-reviewed-capture service (C4, storage rework in C4.1).
 *
 * Turns the data the user verified in the Review screen into real FinanceOS domain
 * records and persists them:
 *
 *   Review model → validate → resolve account/project ids → convert to base currency
 *     → upload original receipt page(s) to Supabase Storage ("receipts" bucket)
 *     → persist header + items atomically
 *     → save receipt_attachments rows using the returned storage paths.
 *
 * The database stores only a reference (storage_path) to each page — never the file
 * bytes. Atomicity for header+items: prefers the save_transaction RPC (migration
 * 005/011 — a single Postgres transaction); falls back to a compensating sequential
 * insert if that RPC isn't registered (PGRST202). Attachment rows are saved as a
 * separate step after the transaction commits (per the specified save flow), so a
 * failure there doesn't roll back an already-saved transaction. All DB/Storage access
 * is through repositories/services — no business logic leaks into the UI.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  accountRepository,
  projectRepository,
  transactionHeaderRepository,
  transactionItemRepository,
  receiptAttachmentRepository,
  receiptStorageRepository,
} from "@/repositories";
import * as transactionService from "@/services/transaction.service";
import { convertToBaseCurrency, ExchangeRateNotFoundError } from "@/services/finance/exchange.service";
import { generateReceiptId } from "@/services/transaction/receiptid.service";
import { GENERIC_PROJECT_NAME } from "@/domain/project";
import { DEFAULT_BASE_CURRENCY } from "@/domain/exchange-rate";
import type { CaptureDocumentPage } from "@/services/ai/ai-provider";
import type { UploadedReceiptPage } from "@/repositories/receipt-storage.repository";
import type { Account } from "@/domain/account";
import type { Project } from "@/domain/project";
import { receiptFolder, extForMime } from "./receipt-path";
import { createStageTimer, type StageTimer } from "@/lib/perf-timer";

export type ReviewedHeader = {
  merchant: string;
  transactionDate: string;
  currency: string;
  paymentMethod: string;
  account: string;
  project: string;
  notes: string;
};

export type ReviewedItem = {
  description: string;
  qty: string;
  amount: string;
  primaryCategory: string;
  secondaryCategory: string;
};

export type ReviewedCapture = {
  header: ReviewedHeader;
  items: ReviewedItem[];
  /** Read-only in Review (from the AI result) but persisted with the transaction. */
  tax: number | null;
  discount: number | null;
};

export type CaptureAudit = {
  aiProvider: string | null;
  processedAt: string | null;
  captureSource: string;
};

export type SaveCaptureInput = {
  reviewed: ReviewedCapture;
  aiContext: string;
  pages: CaptureDocumentPage[];
  audit: CaptureAudit;
  /**
   * C5 (Capture Inbox): the receipt pages were already uploaded to Storage at enqueue
   * time — reference these paths instead of uploading again. When set, `pages` is
   * ignored and the files are NOT removed on a failed transaction save (they still
   * belong to the queue item, which stays in the Inbox for retry).
   */
  preUploadedPages?: UploadedReceiptPage[];
};

/** Thrown for bad Review data — the caller maps this to a friendly, non-crashing message. */
export class SaveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveValidationError";
  }
}

/**
 * `timer` (performance profiling pass, optional): defaults to a fresh, unreported timer
 * so this stays a plain callable service for anything that doesn't care about timing
 * (e.g. the legacy /api/capture/save route) — when a caller passes one (the live Capture
 * Inbox path does, via processQueueItem), these stages land in that SAME shared report.
 */
export async function saveReviewedCapture(
  supabase: SupabaseClient,
  input: SaveCaptureInput,
  timer: StageTimer = createStageTimer()
): Promise<{ headerId: string; receiptId: string }> {
  const { reviewed, pages } = input;

  // 1. Validate (defence-in-depth; the Review screen validates client-side too).
  validate(reviewed);

  // 2. Resolve account/project NAMES (what the dropdowns show) to FK ids. Project
  //    defaults to Generic when the user left it empty.
  const [accounts, projects] = await timer.time("Load Accounts & Projects", () =>
    Promise.all([accountRepository.list(supabase), projectRepository.list(supabase)])
  );
  const mappingStart = performance.now();
  const { sourceAccountId, projectId } = resolveAccountAndProjectIds(accounts, projects, reviewed.header.account, reviewed.header.project);
  // Account mapping and project mapping are one in-memory lookup function, not two
  // separate operations — both land here, both effectively instant (array .find(), no I/O).
  timer.mark("Account & Project Mapping", performance.now() - mappingStart);

  // 3. Totals from the REVIEWED values.
  const subtotal = round2(reviewed.items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0));
  const tax = reviewed.tax ?? 0;
  const discount = reviewed.discount ?? 0;
  const grandTotal = round2(subtotal + tax - discount);

  // 4. Convert the grand total to the base currency for the ledger column.
  const currency = reviewed.header.currency.trim() || DEFAULT_BASE_CURRENCY;
  let baseAmount = grandTotal;
  let exchangeRate: number | null = null;
  try {
    const conversion = await timer.time("Currency Conversion", () => convertToBaseCurrency(supabase, grandTotal, currency));
    baseAmount = conversion.baseAmount;
    exchangeRate = conversion.exchangeRate;
  } catch (err) {
    if (err instanceof ExchangeRateNotFoundError) {
      throw new SaveValidationError(`No exchange rate on file for ${currency}. Add one in Settings › Exchange Rates, then save.`);
    }
    throw err;
  }

  const receiptId = generateReceiptId();
  const transactionDate = reviewed.header.transactionDate.trim() || new Date().toISOString().slice(0, 10);

  // 5. Upload the original receipt page(s) to Storage FIRST — before any database write —
  //    so a storage failure never leaves a half-saved transaction behind. Order is
  //    preserved via page_no (1-based, matching the "Page 1/2/3" numbering in Capture).
  //    The Storage folder is a fresh UUID, deliberately independent of the transaction /
  //    receipt id. Inbox saves (C5) arrive with the pages already uploaded — reuse them.
  //    In the live Capture Inbox flow preUploadedPages is ALWAYS set, so this upload never
  //    actually runs a second time — mark it explicitly rather than leaving it silently
  //    absent from the report, so it's clear this was measured, not forgotten.
  let uploaded: UploadedReceiptPage[];
  if (input.preUploadedPages) {
    timer.mark("Receipt Storage Upload — skipped (pages already uploaded at enqueue)", 0);
    uploaded = input.preUploadedPages;
  } else {
    uploaded = await timer.time("Receipt Storage Upload (Save-time)", () => uploadReceiptPages(supabase, pages));
  }

  // 6. Build the header + items payload (same shape the atomic RPC expects). No
  //    attachment payload here — receipt bytes never touch the database.
  const payload = {
    header: {
      receipt_id: receiptId,
      transaction_date: transactionDate,
      merchant: reviewed.header.merchant.trim(),
      transaction_type: "Expense",
      primary_category: dominantCategory(reviewed.items),
      source_account_id: sourceAccountId,
      target_account_id: null,
      project_id: projectId,
      currency,
      original_amount: grandTotal,
      exchange_rate: exchangeRate,
      sgd_total_amount: baseAmount,
      comments: reviewed.header.notes.trim() || null,
      status: "Confirmed",
    },
    items: reviewed.items.map((item) => ({
      item_description: item.description.trim() || "(unnamed item)",
      tags: null,
      item_group: null,
      search_keywords: null,
      primary_category: item.primaryCategory.trim() || "Miscellaneous",
      secondary_category: item.secondaryCategory.trim() || null,
      // Qty is saved exactly as displayed ("0.5 kg", "2 pcs") — descriptive text, never math.
      qty: item.qty.trim(),
      unit_price: null,
      item_total: round2(Number(item.amount) || 0),
    })),
  };

  // 7. Persist the transaction atomically. If this fails, remove the just-uploaded
  //    pages so nothing orphaned lingers in Storage — unless they were pre-uploaded by
  //    the Capture Inbox, in which case they still belong to the queue item (retry).
  //    Normally ONE atomic RPC round trip (save_transaction) — header and line items are
  //    NOT two separately-measurable operations here; see persist()'s own comment for the
  //    rare fallback path where they genuinely are. persist() records its own stage(s)
  //    directly (not wrapped again here) so the fallback path isn't double-counted under
  //    a misleading "atomic" label.
  let headerId: string;
  try {
    headerId = await persist(supabase, payload, timer);
  } catch (err) {
    if (!input.preUploadedPages) {
      await receiptStorageRepository.removeReceiptPages(supabase, uploaded.map((p) => p.storagePath)).catch(() => {});
    }
    throw err;
  }

  // 8. Save receipt_attachments rows using the storage paths — one row per page, minimum
  //    information only (header_id, storage_path, page_no, created_at; mime/size are
  //    free metadata already on hand). Best-effort: the transaction is already saved, so
  //    an attachment-row failure is logged, not thrown (avoids a retry creating a
  //    duplicate transaction).
  await timer.time("Receipt Attachment Insert", () => saveAttachmentRows(supabase, headerId, uploaded));

  return { headerId, receiptId };
}

function validate(reviewed: ReviewedCapture): void {
  if (!reviewed.header.merchant.trim()) throw new SaveValidationError("Merchant cannot be empty.");
  if (reviewed.items.length === 0) throw new SaveValidationError("At least one line item is required.");
  if (reviewed.items.some((i) => i.amount.trim() !== "" && Number(i.amount) < 0)) throw new SaveValidationError("Amounts cannot be negative.");
}

/**
 * Resolves the Review screen's account/project NAME fields to FK ids — the exact same
 * logic used at create time, reused unchanged by Fix 3's transaction-edit path so
 * account/project resolution is never duplicated.
 */
export function resolveAccountAndProjectIds(
  accounts: Account[],
  projects: Project[],
  accountName: string,
  projectName: string
): { sourceAccountId: string | null; projectId: string | null } {
  const sourceAccountId = accounts.find((a) => a.account_name === accountName)?.id ?? null;
  const resolvedProjectName = projectName.trim() || GENERIC_PROJECT_NAME;
  const projectId =
    projects.find((p) => p.project_name === resolvedProjectName)?.id ?? projects.find((p) => p.project_name === GENERIC_PROJECT_NAME)?.id ?? null;
  return { sourceAccountId, projectId };
}

/** Header category = the item category with the highest total spend. */
export function dominantCategory(items: ReviewedItem[]): string {
  const byCategory = new Map<string, number>();
  for (const item of items) {
    const cat = item.primaryCategory.trim();
    if (!cat) continue;
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + (Number(item.amount) || 0));
  }
  let best: string | null = null;
  let bestAmount = -Infinity;
  for (const [cat, amount] of byCategory) {
    if (amount > bestAmount) {
      best = cat;
      bestAmount = amount;
    }
  }
  return best ?? "Miscellaneous";
}

/**
 * Uploads every page in order under a fresh UUID folder (path: YYYY/MM/<uuid>/page-N.ext,
 * independent of the transaction/receipt id). On partial failure, removes whatever already
 * succeeded and rethrows so nothing is orphaned in Storage.
 */
async function uploadReceiptPages(supabase: SupabaseClient, pages: CaptureDocumentPage[]): Promise<UploadedReceiptPage[]> {
  const folder = receiptFolder();
  const uploaded: UploadedReceiptPage[] = [];
  try {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageNo = i + 1;
      const path = `${folder}/page-${pageNo}${extForMime(page.mimeType)}`;
      const bytes = Buffer.from(page.dataBase64, "base64");
      uploaded.push(await receiptStorageRepository.uploadReceiptPage(supabase, path, bytes, page.mimeType));
    }
  } catch (err) {
    await receiptStorageRepository.removeReceiptPages(supabase, uploaded.map((p) => p.storagePath)).catch(() => {});
    throw err;
  }
  return uploaded;
}

async function saveAttachmentRows(supabase: SupabaseClient, headerId: string, uploaded: UploadedReceiptPage[]): Promise<void> {
  for (let i = 0; i < uploaded.length; i++) {
    const page = uploaded[i];
    try {
      await receiptAttachmentRepository.insert(supabase, {
        header_id: headerId,
        storage_path: page.storagePath,
        page_no: i + 1,
        mime_type: page.mimeType,
        file_size_bytes: page.fileSizeBytes,
        // Unused by this milestone (no thumbnails, no OCR changes, no base64/audit blob).
        original_file_url: "",
        thumbnail_url: "",
        ocr_raw_text: "",
        ai_extraction_json: null,
      });
    } catch (err) {
      console.error(`[save-capture] receipt_attachments insert failed for header ${headerId} page ${i + 1}:`, err);
    }
  }
}

type Payload = transactionService.CreateTransactionInput;

/**
 * Prefer the atomic save_transaction RPC (single Postgres transaction). If it isn't
 * registered yet, fall back to a compensating insert that unwinds partial writes.
 *
 * Performance profiling note: in the normal (RPC) path, "Header Insert" and "Line Item
 * Insert" are NOT two separately-measurable operations — save_transaction persists both
 * in one Postgres round trip. The fallback path below genuinely does them as two
 * sequential steps, and is timed accordingly there.
 */
async function persist(supabase: SupabaseClient, payload: Payload, timer: StageTimer): Promise<string> {
  try {
    const saved = await timer.time("Transaction Persist (header + items, atomic RPC)", () => transactionService.createTransaction(supabase, payload));
    return saved.header.id;
  } catch (err) {
    if (isMissingRpc(err)) {
      // The RPC attempt above is already recorded (it failed fast) — the fallback below
      // records its own two genuinely-separate stages, not a re-wrap of this one.
      return persistWithCompensation(supabase, payload, timer);
    }
    throw err;
  }
}

function isMissingRpc(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "PGRST202";
}

/**
 * All-or-nothing without the RPC: insert header, then items; if items fail, delete the
 * header so no orphaned record survives.
 */
async function persistWithCompensation(supabase: SupabaseClient, payload: Payload, timer: StageTimer): Promise<string> {
  const header = await timer.time("Header Insert (compensation path — RPC unavailable)", () =>
    transactionHeaderRepository.insert(supabase, {
      receipt_id: payload.header.receipt_id,
      transaction_date: payload.header.transaction_date,
      merchant: payload.header.merchant,
      transaction_type: payload.header.transaction_type,
      primary_category: payload.header.primary_category,
      source_account_id: payload.header.source_account_id,
      target_account_id: payload.header.target_account_id,
      project_id: payload.header.project_id,
      currency: payload.header.currency,
      original_amount: String(payload.header.original_amount),
      exchange_rate: payload.header.exchange_rate === null ? null : String(payload.header.exchange_rate),
      sgd_total_amount: String(payload.header.sgd_total_amount),
      comments: payload.header.comments,
      status: payload.header.status,
    })
  );

  try {
    await timer.time(`Line Item Insert × ${payload.items.length} (compensation path — RPC unavailable)`, async () => {
      for (const item of payload.items) {
        await transactionItemRepository.insert(supabase, {
          header_id: header.id,
          receipt_id: payload.header.receipt_id,
          item_description: item.item_description,
          tags: item.tags,
          item_group: item.item_group,
          search_keywords: item.search_keywords,
          primary_category: item.primary_category,
          // Nullable columns: pass null (not "") — "" is invalid for the numeric unit_price.
          secondary_category: (item.secondary_category ?? null) as unknown as string,
          qty: item.qty,
          unit_price: (item.unit_price === null ? null : String(item.unit_price)) as unknown as string,
          item_total: String(item.item_total),
        });
      }
    });
  } catch (err) {
    // Compensate: remove the partial write so the caller sees all-or-nothing.
    await transactionService.deleteTransaction(supabase, header.id).catch(() => {});
    throw err;
  }

  return header.id;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
