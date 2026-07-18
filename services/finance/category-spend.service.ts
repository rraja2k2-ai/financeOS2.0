/**
 * Category spend rollup (TAD-004 §3 Finance Services) — powers Dashboard's "Top
 * Categories" and Budget's "By category" actual figures.
 *
 * transaction_items stores item_total in the transaction's ORIGINAL currency, not
 * SGD — there is no per-item SGD column. To get an SGD figure per item, this prorates
 * each item's share of its header's sgd_total_amount by its share of the header's
 * original_amount: itemSgd = item_total * (header.sgd_total_amount / header.original_amount).
 * This is an approximation (assumes a uniform effective exchange rate across a
 * receipt, which is true — a receipt has one currency and one rate), not a source of
 * rounding-sensitive truth; total category spend across a full receipt still sums to
 * that receipt's real sgd_total_amount.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as transactionHeaderRepository from "@/repositories/transaction-header.repository";
import * as transactionItemRepository from "@/repositories/transaction-item.repository";
import { isExpenseTransaction } from "@/lib/expense-filter";

export type SubcategorySpend = {
  name: string;
  sgdAmount: number;
};

export type CategorySpend = {
  primaryCategory: string;
  sgdAmount: number;
  subcategories: SubcategorySpend[];
};

export async function getCategorySpend(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string
): Promise<CategorySpend[]> {
  const headers = await transactionHeaderRepository.listByDateRange(supabase, startDate, endDate);
  if (headers.length === 0) return [];

  const headerById = new Map(headers.map((h) => [h.id, h]));
  const items = await transactionItemRepository.listByHeaderIds(
    supabase,
    headers.map((h) => h.id)
  );

  const byPrimary = new Map<string, Map<string, number>>();

  for (const item of items) {
    const header = item.header_id ? headerById.get(item.header_id) : undefined;
    if (!header) continue; // orphaned item (known data-quality case, TAD-003 §11.10) — skip, don't crash
    if (!isExpenseTransaction(header)) continue; // credit card payments/transfers are money movements, not expenses

    const originalAmount = Number(header.original_amount);
    const sgdTotal = Number(header.sgd_total_amount);
    const itemTotal = Number(item.item_total);
    const itemSgd = originalAmount > 0 ? (itemTotal / originalAmount) * sgdTotal : 0;

    const primary = normalizeCategory(item.primary_category) ?? "Miscellaneous";
    const secondary = normalizeCategory(item.secondary_category) ?? "General";

    if (!byPrimary.has(primary)) byPrimary.set(primary, new Map());
    const subMap = byPrimary.get(primary)!;
    subMap.set(secondary, (subMap.get(secondary) ?? 0) + itemSgd);
  }

  const result: CategorySpend[] = Array.from(byPrimary.entries()).map(([primaryCategory, subMap]) => {
    const subcategories = Array.from(subMap.entries())
      .map(([name, sgdAmount]) => ({ name, sgdAmount: round2(sgdAmount) }))
      .sort((a, b) => b.sgdAmount - a.sgdAmount);
    const sgdAmount = round2(subcategories.reduce((sum, s) => sum + s.sgdAmount, 0));
    return { primaryCategory, sgdAmount, subcategories };
  });

  return result.sort((a, b) => b.sgdAmount - a.sgdAmount);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Real historical data has a few `null` and literal `"#N/A"` values (spreadsheet import artifacts) — both mean "uncategorized." */
function normalizeCategory(value: string | null): string | null {
  if (!value || value.trim() === "" || value.trim() === "#N/A") return null;
  return value;
}
