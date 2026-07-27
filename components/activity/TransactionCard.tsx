"use client";

import { cn } from "@/lib/utils";
import { currencyPrefix } from "@/lib/currency";
import type { ActivityTransaction } from "@/services/finance/activity.service";
import { fmt, formatCapturedAt, formatFullDate, formatQty, highlight, transactionTitle } from "./activity-format";
import { categoryIcon } from "@/constants/category-icons";

/**
 * The one transaction card design in FinanceOS (CLAUDE.md §3 — "do not create parallel
 * flows"). Used by Activity's own list, Dashboard's Recent Transactions, and Account
 * Detail's Recent Transactions — same visual design everywhere, but each context needs
 * different CLICK behavior (Activity expands in place; Account Detail navigates away to
 * Activity) and its own Edit affordance wiring (Transaction Workspace Foundation — every
 * entry point opens the same shared editor via useTransactionEditor), so both are passed
 * in rather than hardcoded here.
 */

/**
 * Progressive disclosure for long receipts (UI Refresh v2.0, §5). Receipts at or under
 * the threshold show every item — nothing is ever hidden for a normal-sized receipt.
 */
const LONG_RECEIPT_THRESHOLD = 8;
const DEFAULT_VISIBLE_ITEMS = 6;

export type TransactionCardProps = {
  transaction: ActivityTransaction;
  /** Search term to highlight in the merchant/item text — omit outside a search context. */
  query?: string;
  /** Whether the expanded item list is showing. Account Detail never expands in place
   *  (its cards navigate to Activity instead), so it always passes false. */
  isOpen: boolean;
  /** Fires when the header row is tapped. Activity toggles `isOpen`; Account Detail
   *  navigates to Activity filtered/highlighted to this transaction. */
  onToggle: () => void;
  /** The brief "just arrived here" flash border (Activity's highlightId mechanism). */
  isHighlighted?: boolean;
  /** Whether to show the header's ⋮ overflow menu. Activity's own menu has Edit/View
   *  Receipt/Delete; Account Detail's has just Edit (Delete lives inside the shared
   *  editor itself — Transaction Workspace Foundation). Defaults to true. */
  showActions?: boolean;
  /** Required when showActions — reports the trigger button's rect for the portal menu. */
  onActionsClick?: (rect: DOMRect) => void;
  /** Long-receipt "show all items" state for this one card — irrelevant while collapsed. */
  showAllItems?: boolean;
  onShowAllItems?: () => void;
  /** id -> account_name, for the type-aware title (an internal Transfer needs the
   *  destination account's NAME) — see activity-format.tsx's transactionTitle(). */
  accountNameById: Record<string, string>;
};

export function TransactionCard({
  transaction: t,
  query = "",
  isOpen,
  onToggle,
  isHighlighted = false,
  showActions = true,
  onActionsClick,
  showAllItems = false,
  onShowAllItems,
  accountNameById,
}: TransactionCardProps) {
  const Icon = categoryIcon(t.primaryCategory);
  const title = transactionTitle({
    transactionType: t.transactionType,
    merchant: t.merchant,
    sourceAccountName: t.sourceAccountId ? (accountNameById[t.sourceAccountId] ?? null) : null,
    destinationAccountName: t.targetAccountId ? (accountNameById[t.targetAccountId] ?? null) : null,
  });
  const isLongReceipt = t.items.length > LONG_RECEIPT_THRESHOLD;
  const visibleItems = isLongReceipt && !showAllItems ? t.items.slice(0, DEFAULT_VISIBLE_ITEMS) : t.items;
  const hiddenCount = t.items.length - visibleItems.length;

  return (
    <div
      id={`txn-${t.id}`}
      className={cn(
        "mb-2.5 overflow-hidden rounded-[var(--radius-lg)] border bg-card shadow-md transition-colors duration-700",
        isHighlighted ? "border-primary" : "border-border"
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header — a slightly elevated surface (bg-surface-2, an existing token one step
          up from the card's own bg-card) so it reads as "the receipt header" at a
          glance, purely via background/spacing/typography. */}
      <div className="relative bg-surface-2">
        <button
          className={cn(
            "flex w-full items-center gap-3 p-3.5 text-left transition-transform active:scale-[0.99] motion-reduce:transition-none",
            showActions && "pr-11"
          )}
          onClick={onToggle}
          aria-expanded={isOpen}
        >
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[var(--radius-md)] bg-secondary text-muted-foreground">
            <Icon size={18} strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-bold leading-tight">{highlight(title, query)}</p>
            <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
              {t.primaryCategory} · {t.items.length} item{t.items.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex-none text-right">
            {t.currencyGroup === "INR" ? (
              <>
                <div className="font-mono text-[18px] font-bold tabular-nums">
                  {currencyPrefix("INR")}
                  {fmt(t.originalAmount)}
                </div>
                <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground tabular-nums">
                  ≈ {currencyPrefix("SGD")}
                  {fmt(t.sgdAmount)}
                </div>
              </>
            ) : t.currency === "SGD" ? (
              <div className="font-mono text-[18px] font-bold tabular-nums">
                {currencyPrefix("SGD")}
                {fmt(t.originalAmount)}
              </div>
            ) : (
              <>
                <div className="font-mono text-[18px] font-bold tabular-nums">
                  {currencyPrefix("SGD")}
                  {fmt(t.sgdAmount)}
                </div>
                <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground tabular-nums">
                  {currencyPrefix(t.currency)}
                  {fmt(t.originalAmount)}
                </div>
              </>
            )}
          </div>
        </button>

        {showActions && (
          <button
            type="button"
            aria-label="Transaction actions"
            title="Transaction actions"
            onClick={(e) => {
              e.stopPropagation();
              onActionsClick?.(e.currentTarget.getBoundingClientRect());
            }}
            className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="12" cy="19" r="1.8" />
            </svg>
          </button>
        )}
      </div>

      {/* Expanded items (UI refinement — Apple Wallet-style receipt scan, not a
          timeline): plain rows, one shared hairline divider between them, no connector
          line/dots, no qty badge. Line 1 (name + amount) carries the strongest type on
          the row; line 2 is muted single-line "qty • Secondary Category" (never
          Primary). Fades in on open; collapse stays instant. */}
      {isOpen && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none border-t border-border/60">
          <div className="flex flex-wrap items-baseline gap-x-1.5 border-b border-border/60 px-3.5 py-3 text-[10.5px] text-muted-foreground">
            <span>
              Receipt <span className="font-medium text-foreground/60">{formatFullDate(t.transactionDate)}</span>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Captured <span className="font-medium text-foreground/60">{formatCapturedAt(t.capturedAt)}</span>
            </span>
          </div>
          <div className="pt-1.5 px-3.5">
            {visibleItems.map((item, i) => {
              const line2 = [formatQty(item.qty) || null, item.secondaryCategory || null].filter(Boolean).join(" • ");
              return (
                <div key={item.id} className={cn("flex flex-col gap-1.5 py-3", i > 0 && "border-t border-border/60")}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-[14px] font-semibold text-foreground">{highlight(item.description, query)}</p>
                    <span className="flex-none text-right font-mono text-[16px] font-bold tabular-nums">{fmt(item.itemTotal)}</span>
                  </div>
                  {line2 && <p className="truncate text-[11.5px] text-muted-foreground">{line2}</p>}
                </div>
              );
            })}
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={onShowAllItems}
              className="block w-full border-t border-dashed border-border/60 py-2.5 pl-3.5 pr-3.5 text-left text-[12px] font-semibold text-primary"
            >
              Show remaining {hiddenCount} item{hiddenCount === 1 ? "" : "s"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
