"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityItem, ActivityTransaction } from "@/services/finance/activity.service";
import { fmt, formatQty, formatShortDate, highlight } from "@/components/activity/activity-format";
import { deriveUnitPrice, selectComparableCandidates, computePriceIntelligence, type PriceIntelligenceSummary } from "@/services/finance/price-intelligence.service";

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

function unitPriceLabel(summary: Pick<PriceIntelligenceSummary, "currency" | "unitLabel">, value: number): string {
  return `${summary.currency} ${fmt(value)}/${summary.unitLabel}`;
}

/** Price Intelligence Version 1 summary card — one per (measurement family, currency)
 *  group with 2+ priceable purchases, computed directly over the search results passed
 *  in (see price-intelligence.service.ts's file header on why there's no separate
 *  description grouping). Titled with the search term itself, since that's what defines
 *  the comparison universe now — plus a "by kg/L/pc" qualifier, since one search can
 *  legitimately produce more than one card (e.g. a search matching both weight- and
 *  count-priced items). Purely presentational: every number comes straight from
 *  computePriceIntelligence(), never recalculated here. */
function PriceIntelligenceCard({ summary, query }: { summary: PriceIntelligenceSummary; query: string }) {
  return (
    <div className="mb-2 rounded-[var(--radius-md)] border border-border bg-card p-3">
      <p className="mb-1.5 text-[12.5px] font-bold">
        {query} <span className="font-normal text-muted-foreground">· by {summary.unitLabel}</span>
      </p>
      <div className="grid grid-cols-3 gap-2 text-[10.5px]">
        <div>
          <p className="text-muted-foreground">Lowest</p>
          <p className="font-mono font-semibold text-foreground">{unitPriceLabel(summary, summary.lowestPrice)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Highest</p>
          <p className="font-mono font-semibold text-foreground">{unitPriceLabel(summary, summary.highestPrice)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Average</p>
          <p className="font-mono font-semibold text-foreground">{unitPriceLabel(summary, summary.averagePrice)}</p>
        </div>
      </div>
      <p className="mt-1.5 text-[10.5px] text-muted-foreground">
        Last purchased {formatShortDate(summary.lastPurchased)} · {summary.purchaseCount} purchases
      </p>
    </div>
  );
}

export function FilteredLineItemList({
  items,
  emptyMessage,
  query,
  onOpenItem,
  showPriceIntelligence,
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
  /** Price Intelligence Version 1 — only meaningful for Search's own text-match results
   *  (comparing named grocery items over time); Category Filter's results are an
   *  arbitrary category, not "the same item," so it never passes this. Defaults to false. */
  showPriceIntelligence?: boolean;
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
  // Search decided what's displayed (items); selectComparableCandidates() decides what's
  // honestly comparable (only items whose OWN description contains the search text) before
  // computePriceIntelligence() ever runs — a merchant match ("NTUC") or category match
  // ("Dairy & Eggs") never reaches the summary, since no item's own description contains
  // those strings. See price-intelligence.service.ts's file header.
  const priceSummaries = showPriceIntelligence ? computePriceIntelligence(selectComparableCandidates(items, q)) : [];

  return (
    <>
      {priceSummaries.map((summary) => (
        <PriceIntelligenceCard key={`${summary.family}::${summary.currency}`} summary={summary} query={q} />
      ))}
      <div className="mb-3 rounded-[var(--radius-md)] bg-secondary px-3.5 py-2.5 text-[12px] font-semibold text-muted-foreground">
        {items.length} matching item{items.length === 1 ? "" : "s"} •{" "}
        <span className="font-mono font-bold text-foreground">
          {currency} {fmt(total)}
        </span>
      </div>
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-border bg-card">
        {items.map((item, i) => {
          const qtyText = formatQty(item.qty);
          const unitPrice = deriveUnitPrice(item.qty, item.unit, item.itemTotal);
          return (
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
                {/* Quantity (navy — a neutral accent distinct from the emerald search
                    highlight/primary color) | Category (secondary gray), separated by a
                    pipe rather than a bullet for clearer visual separation. */}
                <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                  {qtyText && (
                    <>
                      <span className="font-medium text-navy">{qtyText}</span>
                      {" | "}
                    </>
                  )}
                  {q ? highlight(categoryPath(item.primaryCategory, item.secondaryCategory), q) : categoryPath(item.primaryCategory, item.secondaryCategory)}
                </p>
                {/* Price Intelligence Version 1 — derived fresh from qty/unit/itemTotal
                    (price-intelligence.service.ts), never from the stored unit_price
                    column. Omitted entirely when it can't be honestly derived. */}
                {unitPrice && (
                  <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                    Unit Price <span className="font-mono font-semibold text-foreground">{item.currency} {fmt(unitPrice.valuePerUnit)}/{unitPrice.unitLabel}</span>
                  </p>
                )}
              </div>
              <ChevronRight size={16} strokeWidth={2.3} className="mt-1 flex-none text-muted-foreground" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </>
  );
}
