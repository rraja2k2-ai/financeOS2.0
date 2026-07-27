/**
 * Update an existing transaction from the Review screen (Fix 3 — Activity Edit & Delete).
 *
 * Reuses transaction.service.ts's getTransaction/updateTransaction and the exact same
 * account/project resolution, dominant-category, and rounding logic as the create path
 * (save-capture.service.ts, imported not duplicated) — the only thing that differs from
 * a fresh capture is that this UPDATEs an existing header + its existing item rows
 * instead of inserting new ones.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountRepository, projectRepository } from "@/repositories";
import * as transactionService from "@/services/transaction.service";
import { convertToBaseCurrency, ExchangeRateNotFoundError } from "@/services/finance/exchange.service";
import { DEFAULT_BASE_CURRENCY } from "@/domain/exchange-rate";
import {
  dominantCategory,
  resolveAccountAndProjectIds,
  resolveMerchantForSave,
  round2,
  validateForType,
  SaveValidationError,
  type ReviewedCapture,
} from "./save-capture.service";
import type { CaptureReceiptResult } from "@/services/ai/ai-provider";
import type { TransactionItem } from "@/domain/transaction-item";
import { TRANSACTION_TYPES, isTransactionType } from "@/constants/transaction-types";

/**
 * The exact, whitelisted subset of transaction_items columns a Review Screen Save is
 * allowed to touch (Receipt Intelligence Foundation follow-up). `unit`/`pack_size`/
 * `unit_price` are deliberately NOT in this list — there is still no UI to edit them, so
 * an edit-save must never overwrite whatever a future milestone eventually writes there.
 * Typing the per-item update literal below against this Pick (not the generic
 * `Partial<TransactionItem>` transactionService.updateTransaction accepts) turns that
 * intent into a compile error, not just a code-review convention: adding `unit: null`
 * (or any other column not listed here) to the object literal below fails
 * `npx tsc --noEmit` via TypeScript's excess-property check, instead of silently
 * reintroducing the overwrite bug this whitelist exists to prevent.
 */
type ReviewEditableItemUpdate = Pick<TransactionItem, "item_description" | "primary_category" | "secondary_category" | "qty" | "item_total"> & {
  id: string;
};

export type TransactionForReview = {
  result: CaptureReceiptResult;
  /** transaction_items ids, in the SAME order as `result.items` — re-zipped with the edited items on save. */
  itemIds: string[];
  /** Ingestion timestamp (transaction_headers.created_at) — read-only display in the
   *  Workspace/Review screen (Transaction Workspace Foundation). Never editable; see
   *  CLAUDE.md §7's "Two distinct dates" architecture. Same raw value as
   *  RecentTransaction.capturedAt (activity.service.ts), just reused here so every
   *  entry point that opens the editor gets it from this one reshape function. */
  capturedAt: string;
};

/**
 * Loads an existing transaction and shapes it exactly like a fresh AI result, so the
 * SAME ReviewScreen component (unmodified) can edit it — there is only one editor in
 * FinanceOS.
 */
export async function getTransactionForReview(supabase: SupabaseClient, headerId: string): Promise<TransactionForReview | null> {
  const transaction = await transactionService.getTransaction(supabase, headerId);
  if (!transaction) return null;
  const { header, items } = transaction;

  const [account, project, destinationAccount] = await Promise.all([
    header.source_account_id ? accountRepository.getById(supabase, header.source_account_id) : Promise.resolve(null),
    header.project_id ? projectRepository.getById(supabase, header.project_id) : Promise.resolve(null),
    header.target_account_id ? accountRepository.getById(supabase, header.target_account_id) : Promise.resolve(null),
  ]);

  // tax/discount aren't stored as separate columns — only the grand total is. Back-derive
  // a single adjustment line (the same "one tax OR one discount line, never both" rule
  // used at save time) so the Summary's Grand Total matches the saved total until the
  // user actually changes an amount.
  const itemsSum = round2(items.reduce((sum, i) => sum + Number(i.item_total), 0));
  const storedTotal = round2(Number(header.original_amount));
  const adjustment = round2(storedTotal - itemsSum);
  const tax = adjustment > 0 ? adjustment : null;
  const discount = adjustment < 0 ? -adjustment : null;

  const result: CaptureReceiptResult = {
    header: {
      merchant: header.merchant,
      transactionDate: header.transaction_date,
      currency: header.currency,
      // No payment_method column exists on transaction_headers — same pre-existing gap
      // as the create flow (it's collected in Review but was never persisted there either).
      paymentMethod: null,
      total: storedTotal,
      tax,
      discount,
      notes: header.comments,
      transactionType: isTransactionType(header.transaction_type) ? header.transaction_type : TRANSACTION_TYPES.EXPENSE,
    },
    items: items.map((item) => ({
      description: item.item_description,
      qty: null,
      // The saved qty is already the full free-text value ("0.5 kg", "2 pcs", or now
      // "1 bag (5 kg)" under the Gemini Receipt Intelligence Contract). Packing it into
      // `unit` (with `qty` null) makes reviewedFromResult's join logic reconstruct it
      // unchanged — no new code path.
      unit: item.qty,
      // Deliberately null here, NOT item.pack_size — the saved qty text above already
      // contains any pack size as part of its free-text ("1 bag (5 kg)"). If this were
      // item.pack_size, reviewedFromResult's join would append it a SECOND time
      // ("1 bag (5 kg) (5 kg)"). unitPrice has no such join/duplication risk — it never
      // feeds the qty free-text — so it carries the real stored value straight through.
      packSize: null,
      unitPrice: item.unit_price !== null ? Number(item.unit_price) : null,
      lineAmount: Number(item.item_total),
      primaryCategory: item.primary_category,
      secondaryCategory: item.secondary_category,
    })),
    headerSuggestions: {
      account: account?.account_name ?? null,
      project: project?.project_name ?? null,
      destinationAccount: destinationAccount?.account_name ?? null,
    },
    other: { tags: [], confidence: null, summary: null },
  };

  return { result, itemIds: items.map((i) => i.id), capturedAt: header.created_at };
}

/**
 * Persists Review edits back onto an EXISTING transaction — always an UPDATE, never a
 * new transaction. Recomputes the header's dominant category from the edited items
 * (the one piece of derived metadata the system maintains) since Description/Category/
 * Subcategory may have changed. Tags, item_group, search_keywords, unit, pack_size, and
 * unit_price are left exactly as they were — those remain parked, per Fix 3's scope /
 * Receipt Intelligence Foundation; see `ReviewEditableItemUpdate` above for the
 * compiler-enforced whitelist of what this function is allowed to touch per item.
 */
export async function updateReviewedTransaction(
  supabase: SupabaseClient,
  headerId: string,
  itemIds: string[],
  reviewed: ReviewedCapture
): Promise<void> {
  const [firstError] = validateForType(reviewed);
  if (firstError) throw new SaveValidationError(firstError);
  if (itemIds.length !== reviewed.items.length) {
    throw new SaveValidationError("Line items changed unexpectedly — please reopen and try again.");
  }

  const [accounts, projects] = await Promise.all([accountRepository.list(supabase), projectRepository.list(supabase)]);
  const { sourceAccountId, projectId, destinationAccountId } = resolveAccountAndProjectIds(
    accounts,
    projects,
    reviewed.header.account,
    reviewed.header.project,
    reviewed.header.destinationAccount
  );

  const subtotal = round2(reviewed.items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0));
  const tax = reviewed.tax ?? 0;
  const discount = reviewed.discount ?? 0;
  const grandTotal = round2(subtotal + tax - discount);

  const currency = reviewed.header.currency.trim() || DEFAULT_BASE_CURRENCY;
  let baseAmount = grandTotal;
  let exchangeRate: number | null = null;
  try {
    const conversion = await convertToBaseCurrency(supabase, grandTotal, currency);
    baseAmount = conversion.baseAmount;
    exchangeRate = conversion.exchangeRate;
  } catch (err) {
    if (err instanceof ExchangeRateNotFoundError) {
      throw new SaveValidationError(`No exchange rate on file for ${currency}. Add one in Settings › Exchange Rates, then save.`);
    }
    throw err;
  }

  await transactionService.updateTransaction(supabase, headerId, {
    header: {
      merchant: resolveMerchantForSave(reviewed.header.transactionType, reviewed.header.merchant, destinationAccountId),
      transaction_date: reviewed.header.transactionDate.trim() || new Date().toISOString().slice(0, 10),
      transaction_type: reviewed.header.transactionType,
      currency,
      source_account_id: sourceAccountId,
      target_account_id: destinationAccountId,
      project_id: projectId,
      primary_category: dominantCategory(reviewed.items),
      original_amount: String(grandTotal),
      exchange_rate: exchangeRate === null ? null : String(exchangeRate),
      sgd_total_amount: String(baseAmount),
      comments: reviewed.header.notes.trim() || null,
    },
    items: reviewed.items.map(
      (item, i): ReviewEditableItemUpdate => ({
        id: itemIds[i],
        item_description: item.description.trim() || "(unnamed item)",
        primary_category: item.primaryCategory.trim() || "Miscellaneous",
        secondary_category: (item.secondaryCategory.trim() || null) as unknown as string,
        qty: item.qty.trim(),
        item_total: String(round2(Number(item.amount) || 0)),
      })
    ),
  });
}
