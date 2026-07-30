"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityItem, ActivityTransaction } from "@/services/finance/activity.service";
import { fmt, formatQty, formatShortDate, highlight } from "@/components/activity/activity-format";

/**
 * Unify Filtered Line Item Experience — the one flat row shape every filtered Activity
 * view (Search today; Category Filter now; Merchant/Budget/Project drill-down later)
 * renders through, so "filtering always shows line items, in one consistent layout" is
 * true by construction rather than re-implemented per filter. Design principle:
 * Browsing = Transaction Headers (TransactionCard, unchanged), Filtering = Line Items
 * (this component). Only the FILTERING predicate differs per caller — see
 * filterLineItems() below.
 */
export type FilteredLineItem = ActivityItem & {
  txnId: string;
  merchant: string | null;
  transactionDate: string;
  currency: string;
};

/** Flattens matching transactions down to their individual matching line items — the
 *  shared mechanic behind both Search's text predicate and Category Filter's
 *  category-match predicate. `predicate` is the only thing that differs per caller. */
export function filterLineItems(
  transactions: ActivityTransaction[],
  predicate: (item: ActivityItem, txn: ActivityTransaction) => boolean
): FilteredLineItem[] {
  const results: FilteredLineItem[] = [];
  for (const t of transactions) {
    for (const item of t.items) {
      if (predicate(item, t)) {
        results.push({ ...item, txnId: t.id, merchant: t.merchant, transactionDate: t.transactionDate, currency: t.currency });
      }
    }
  }
  return results;
}

export function categoryPath(primary: string | null, secondary: string | null): string {
  if (primary && secondary) return `${primary} > ${secondary}`;
  return primary ?? secondary ?? "—";
}

export function FilteredLineItemList({
  items,
  emptyMessage,
  query,
  onOpenItem,
}: {
  items: FilteredLineItem[];
  /** Shown instead of the list when there are no matches. */
  emptyMessage: string;
  /** Search term to visually highlight within each row — omitted for non-text filters
   *  (e.g. Category Filter), which have nothing to highlight. */
  query?: string;
  /** Tapping any row opens the Transaction Workspace (the shared Review/Edit screen —
   *  CLAUDE.md §7's "One Review Screen, reused") for that item's parent transaction.
   *  Callers render it as an overlay (never a route change), so closing it returns to
   *  this exact list with its filter/search/scroll state untouched — nothing here needs
   *  to save or restore that state itself. */
  onOpenItem: (txnId: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  const total = items.reduce((sum, i) => sum + i.itemTotal, 0);
  const currency = items[0].currency;
  const q = query?.trim() ?? "";

  return (
    <>
      <div className="mb-3 rounded-[var(--radius-md)] bg-secondary px-3.5 py-2.5 text-[12px] font-semibold text-muted-foreground">
        {items.length} matching item{items.length === 1 ? "" : "s"} •{" "}
        <span className="font-mono font-bold text-foreground">
          {currency} {fmt(total)}
        </span>
      </div>
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-border bg-card">
        {items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpenItem(item.txnId)}
            className={cn("flex w-full items-start gap-3 px-3.5 py-3 text-left", i > 0 && "border-t border-border")}
          >
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-[10.5px] font-semibold text-muted-foreground">{formatShortDate(item.transactionDate)}</p>
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-[13.5px] font-semibold text-foreground">{q ? highlight(item.description, q) : (item.description ?? "Untitled item")}</p>
                <span className="flex-none font-mono text-[13.5px] font-bold tabular-nums">
                  {item.currency} {fmt(item.itemTotal)}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{q ? highlight(item.merchant, q) : (item.merchant ?? "—")}</p>
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                {formatQty(item.qty) && <span className="font-medium text-primary">{formatQty(item.qty)} • </span>}
                {q ? highlight(categoryPath(item.primaryCategory, item.secondaryCategory), q) : categoryPath(item.primaryCategory, item.secondaryCategory)}
              </p>
            </div>
            <ChevronRight size={16} strokeWidth={2.3} className="mt-1 flex-none text-muted-foreground" aria-hidden="true" />
          </button>
        ))}
      </div>
    </>
  );
}
