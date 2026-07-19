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
import { dominantCategory, resolveAccountAndProjectIds, round2, SaveValidationError, type ReviewedCapture } from "./save-capture.service";
import type { CaptureReceiptResult } from "@/services/ai/ai-provider";

export type TransactionForReview = {
  result: CaptureReceiptResult;
  /** transaction_items ids, in the SAME order as `result.items` — re-zipped with the edited items on save. */
  itemIds: string[];
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

  const [account, project] = await Promise.all([
    header.source_account_id ? accountRepository.getById(supabase, header.source_account_id) : Promise.resolve(null),
    header.project_id ? projectRepository.getById(supabase, header.project_id) : Promise.resolve(null),
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
    },
    items: items.map((item) => ({
      description: item.item_description,
      qty: null,
      // The saved qty is already the full free-text value ("0.5 kg", "2 pcs"). Packing it
      // into `unit` (with `qty` null) makes ReviewScreen's existing join logic
      // ([qty, unit].filter(Boolean).join(" ")) reconstruct it unchanged — no new code path.
      unit: item.qty,
      unitPrice: item.unit_price !== null ? Number(item.unit_price) : null,
      lineAmount: Number(item.item_total),
      primaryCategory: item.primary_category,
      secondaryCategory: item.secondary_category,
    })),
    headerSuggestions: {
      account: account?.account_name ?? null,
      project: project?.project_name ?? null,
    },
    other: { tags: [], confidence: null, summary: null },
  };

  return { result, itemIds: items.map((i) => i.id) };
}

/**
 * Persists Review edits back onto an EXISTING transaction — always an UPDATE, never a
 * new transaction. Recomputes the header's dominant category from the edited items
 * (the one piece of derived metadata the system maintains) since Description/Category/
 * Subcategory may have changed. Tags, item_group, and search_keywords are left exactly
 * as they were — those remain parked, per Fix 3's scope.
 */
export async function updateReviewedTransaction(
  supabase: SupabaseClient,
  headerId: string,
  itemIds: string[],
  reviewed: ReviewedCapture
): Promise<void> {
  if (!reviewed.header.merchant.trim()) throw new SaveValidationError("Merchant cannot be empty.");
  if (reviewed.items.length === 0) throw new SaveValidationError("At least one line item is required.");
  if (reviewed.items.some((i) => i.amount.trim() !== "" && Number(i.amount) < 0)) throw new SaveValidationError("Amounts cannot be negative.");
  if (itemIds.length !== reviewed.items.length) {
    throw new SaveValidationError("Line items changed unexpectedly — please reopen and try again.");
  }

  const [accounts, projects] = await Promise.all([accountRepository.list(supabase), projectRepository.list(supabase)]);
  const { sourceAccountId, projectId } = resolveAccountAndProjectIds(accounts, projects, reviewed.header.account, reviewed.header.project);

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
      merchant: reviewed.header.merchant.trim(),
      transaction_date: reviewed.header.transactionDate.trim() || new Date().toISOString().slice(0, 10),
      currency,
      source_account_id: sourceAccountId,
      project_id: projectId,
      primary_category: dominantCategory(reviewed.items),
      original_amount: String(grandTotal),
      exchange_rate: exchangeRate === null ? null : String(exchangeRate),
      sgd_total_amount: String(baseAmount),
      comments: reviewed.header.notes.trim() || null,
    },
    items: reviewed.items.map((item, i) => ({
      id: itemIds[i],
      item_description: item.description.trim() || "(unnamed item)",
      primary_category: item.primaryCategory.trim() || "Miscellaneous",
      secondary_category: (item.secondaryCategory.trim() || null) as unknown as string,
      qty: item.qty.trim(),
      item_total: String(round2(Number(item.amount) || 0)),
    })),
  });
}
