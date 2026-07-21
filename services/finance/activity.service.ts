/**
 * Activity rollup (TAD-004 §3 Transaction Services) — powers the Activity screen.
 * Fetches headers + their items for a date range and assembles a display-ready list.
 * Client-side period/search/currency-group filtering then operates on this single
 * fetched set (see components/activity/ActivityView.tsx) — avoids a server round-trip
 * per filter interaction.
 *
 * Note: description/primaryCategory/merchant are typed nullable here even though the
 * DB columns are non-null `string` — real historical rows (pre-classification-pipeline
 * seed data) do contain empty/null-ish values in practice, and a null here crashed the
 * Activity search feature once already. Treat as "string, but don't trust it."
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as transactionHeaderRepository from "@/repositories/transaction-header.repository";
import * as transactionItemRepository from "@/repositories/transaction-item.repository";
import type { TransactionItem } from "@/domain/transaction-item";
import type { CategorySpend } from "./category-spend.service";
import { isExpenseTransaction } from "@/lib/expense-filter";

export type ActivityItem = {
  id: string;
  description: string | null;
  qty: string;
  unitPrice: number | null;
  itemTotal: number;
  primaryCategory: string | null;
  secondaryCategory: string | null;
};

export type ActivityTransaction = {
  id: string;
  receiptId: string;
  merchant: string | null;
  /** Receipt/business date (transaction_headers.transaction_date) — the primary date
   *  Activity sorts, groups, and filters by. See CLAUDE.md §7. */
  transactionDate: string;
  /** Ingestion timestamp (transaction_headers.created_at) — display-only, shown alongside
   *  transactionDate inside the expanded transaction. Never drives Activity's ordering or
   *  grouping; that's transactionDate's job. See CLAUDE.md §7. */
  capturedAt: string;
  currency: string;
  originalAmount: number;
  sgdAmount: number;
  primaryCategory: string | null;
  /** Expense | Payment | Transfer | Lending (TAD-003 §11.2) — needed to exclude money movements from expense analytics, see lib/expense-filter.ts. */
  transactionType: string;
  /** SGD if currency !== INR, INR if currency === INR — per the Activity screen's two-bucket design. */
  currencyGroup: "SGD" | "INR";
  items: ActivityItem[];
};

export async function getActivity(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string
): Promise<ActivityTransaction[]> {
  const headers = await transactionHeaderRepository.listByDateRange(supabase, startDate, endDate);
  if (headers.length === 0) return [];

  const items = await transactionItemRepository.listByHeaderIds(
    supabase,
    headers.map((h) => h.id)
  );

  const itemsByHeader = new Map<string, TransactionItem[]>();
  for (const item of items) {
    if (!item.header_id) continue;
    if (!itemsByHeader.has(item.header_id)) itemsByHeader.set(item.header_id, []);
    itemsByHeader.get(item.header_id)!.push(item);
  }

  // Activity always sorts by the receipt/business date (transaction_date), never by
  // ingestion time — this is the accounting timeline (also used by Budget/Reports/
  // Project allocations), so a receipt captured today for an older expense still lands
  // under its own date. created_at (capturedAt below) is display-only here. See
  // CLAUDE.md §7. Same-day headers tiebreak newest-captured-first.
  const sortedHeaders = [...headers].sort(
    (a, b) => b.transaction_date.localeCompare(a.transaction_date) || b.created_at.localeCompare(a.created_at)
  );

  const transactions = sortedHeaders.map((header): ActivityTransaction => {
    const headerItems = itemsByHeader.get(header.id) ?? [];

    const activityItems: ActivityItem[] = headerItems.map((it) => ({
      id: it.id,
      description: it.item_description,
      qty: it.qty,
      unitPrice: it.unit_price !== null ? Number(it.unit_price) : null,
      itemTotal: Number(it.item_total),
      primaryCategory: it.primary_category,
      secondaryCategory: it.secondary_category,
    }));

    return {
      id: header.id,
      receiptId: header.receipt_id,
      merchant: header.merchant,
      transactionDate: header.transaction_date,
      capturedAt: header.created_at,
      currency: header.currency,
      originalAmount: Number(header.original_amount),
      sgdAmount: Number(header.sgd_total_amount),
      primaryCategory: header.primary_category,
      transactionType: header.transaction_type,
      currencyGroup: header.currency === "INR" ? "INR" : "SGD",
      items: activityItems,
    };
  });

  return transactions;
}

export type RecentTransaction = {
  id: string;
  merchant: string | null;
  /** Receipt/business date (transaction_headers.transaction_date) — shown alongside
   *  capturedAt (Fix 6.4.4) so the card tells the user where to find this transaction
   *  inside Activity, which groups by Receipt Date. Display-only here; this card's
   *  ordering stays Ingestion Date. See CLAUDE.md §7. */
  transactionDate: string;
  /** Ingestion timestamp (transaction_headers.created_at) — drives this card's ordering
   *  (via listRecent) and is shown alongside transactionDate. See CLAUDE.md §7. */
  capturedAt: string;
  primaryCategory: string | null;
  currency: string;
  originalAmount: number;
  sgdAmount: number;
  currencyGroup: "SGD" | "INR";
};

/** Lightweight header-only feed for the Dashboard's Recent Transactions card — no items fetch.
 *  Ordered by capture time (listRecent), never the receipt's own printed date. */
export async function getRecentTransactions(supabase: SupabaseClient, limit: number): Promise<RecentTransaction[]> {
  const headers = await transactionHeaderRepository.listRecent(supabase, limit);

  return headers.map((header) => ({
    id: header.id,
    merchant: header.merchant,
    transactionDate: header.transaction_date,
    capturedAt: header.created_at,
    primaryCategory: header.primary_category,
    currency: header.currency,
    originalAmount: Number(header.original_amount),
    sgdAmount: Number(header.sgd_total_amount),
    currencyGroup: header.currency === "INR" ? "INR" : "SGD",
  }));
}

/**
 * Category spend for the Activity page's "Top Categories" card, computed client-side
 * from already-fetched ActivityTransactions (no extra round-trip when the period
 * changes) — same proration math as category-spend.service.ts (which does the
 * equivalent server-side for Dashboard/Budget): itemSgd = itemTotal * (sgdAmount /
 * originalAmount), since transaction_items has no per-item SGD column.
 */
export function computeCategorySpendFromTransactions(transactions: ActivityTransaction[]): CategorySpend[] {
  const byPrimary = new Map<string, Map<string, number>>();

  for (const t of transactions) {
    if (!isExpenseTransaction({ transaction_type: t.transactionType, primary_category: t.primaryCategory })) continue;
    for (const item of t.items) {
      const itemSgd = t.originalAmount > 0 ? (item.itemTotal / t.originalAmount) * t.sgdAmount : 0;
      const primary = normalizeCategory(item.primaryCategory) ?? "Miscellaneous";
      const secondary = normalizeCategory(item.secondaryCategory) ?? "General";

      if (!byPrimary.has(primary)) byPrimary.set(primary, new Map());
      const subMap = byPrimary.get(primary)!;
      subMap.set(secondary, (subMap.get(secondary) ?? 0) + itemSgd);
    }
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
