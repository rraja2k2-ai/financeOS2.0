"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { ActivityTransaction } from "@/services/finance/activity.service";
import { computeCategorySpendFromTransactions } from "@/services/finance/activity.service";
import { PeriodSelector } from "@/components/shared/PeriodSelector";
import { TopCategoriesCard } from "@/components/shared/TopCategoriesCard";
import { resolvePeriodRange, startOfMonthIso, todayIso, type PeriodKey } from "@/lib/period";

export type ActivityViewProps = {
  transactions: ActivityTransaction[];
  /** From ?highlight=<id> (Dashboard's Recent Transactions deep link) — auto-expands and scrolls to this transaction. */
  highlightId?: string;
};

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function categoryPath(primary: string | null, secondary: string | null): string {
  if (primary && secondary) return `${primary} > ${secondary}`;
  return primary ?? secondary ?? "—";
}

function highlight(text: string | null | undefined, query: string) {
  const safe = text ?? "";
  if (!query.trim()) return safe;
  const idx = safe.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return safe;
  return (
    <>
      {safe.slice(0, idx)}
      <mark className="rounded bg-accent px-0.5 text-accent-foreground">{safe.slice(idx, idx + query.length)}</mark>
      {safe.slice(idx + query.length)}
    </>
  );
}

export function ActivityView({ transactions, highlightId }: ActivityViewProps) {
  const highlightedTxn = highlightId ? transactions.find((t) => t.id === highlightId) : undefined;

  // A highlighted transaction might be outside "this month" or the default SGD group —
  // widen the filters up front so it's actually visible rather than silently filtered out.
  const [period, setPeriod] = useState<PeriodKey>(highlightedTxn ? "last6" : "this-month");
  const [customStart, setCustomStart] = useState(startOfMonthIso());
  const [customEnd, setCustomEnd] = useState(todayIso());
  const [group, setGroup] = useState<"SGD" | "INR">(highlightedTxn?.currencyGroup ?? "SGD");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(highlightId ?? null);

  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`txn-${highlightId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId]);

  /**
   * Clicking a matched item in search results jumps to its parent transaction in the
   * normal (non-search) list, expanded and scrolled into view — the transaction is
   * already guaranteed to be in the current period/group since matchedItems is derived
   * from groupTxns, so no filter changes are needed, just clearing the search query.
   */
  function jumpToTransaction(txnId: string) {
    setQuery("");
    setExpanded(txnId);
    requestAnimationFrame(() => {
      document.getElementById(`txn-${txnId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  const { start: periodStart, end: periodEnd } = resolvePeriodRange(period, customStart, customEnd);

  const inPeriod = useMemo(
    () => transactions.filter((t) => t.transactionDate >= periodStart && t.transactionDate <= periodEnd),
    [transactions, periodStart, periodEnd]
  );

  const categorySpend = useMemo(() => computeCategorySpendFromTransactions(inPeriod), [inPeriod]);

  const sgdGroupTxns = inPeriod.filter((t) => t.currencyGroup === "SGD");
  const inrGroupTxns = inPeriod.filter((t) => t.currencyGroup === "INR");

  const sgdTotal = sgdGroupTxns.reduce((sum, t) => sum + t.sgdAmount, 0);
  const inrNativeTotal = inrGroupTxns.reduce((sum, t) => sum + t.originalAmount, 0);
  const inrSgdTotal = inrGroupTxns.reduce((sum, t) => sum + t.sgdAmount, 0);

  const groupTxns = group === "SGD" ? sgdGroupTxns : inrGroupTxns;
  const q = query.trim().toLowerCase();

  // Search mode: surface matching LINE ITEMS directly (not whole transactions) — a
  // "milk" search should show just the milk line(s) and their own total, not every
  // item on a receipt that happens to contain milk somewhere.
  type MatchedItem = ActivityTransaction["items"][number] & {
    txnId: string;
    merchant: string | null;
    transactionDate: string;
    currency: string;
  };

  const matchedItems: MatchedItem[] = useMemo(() => {
    if (!q) return [];
    const results: MatchedItem[] = [];
    for (const t of groupTxns) {
      for (const item of t.items) {
        const hit =
          (item.description ?? "").toLowerCase().includes(q) ||
          (item.primaryCategory ?? "").toLowerCase().includes(q) ||
          (item.secondaryCategory ?? "").toLowerCase().includes(q) ||
          (t.merchant ?? "").toLowerCase().includes(q);
        if (hit) {
          results.push({ ...item, txnId: t.id, merchant: t.merchant, transactionDate: t.transactionDate, currency: t.currency });
        }
      }
    }
    return results;
  }, [groupTxns, q]);

  const matchedTotal = matchedItems.reduce((sum, i) => sum + i.itemTotal, 0);

  const matchedByDate = useMemo(() => {
    const map = new Map<string, MatchedItem[]>();
    for (const i of matchedItems) {
      if (!map.has(i.transactionDate)) map.set(i.transactionDate, []);
      map.get(i.transactionDate)!.push(i);
    }
    return Array.from(map.entries());
  }, [matchedItems]);

  const byDate = useMemo(() => {
    const map = new Map<string, ActivityTransaction[]>();
    for (const t of groupTxns) {
      if (!map.has(t.transactionDate)) map.set(t.transactionDate, []);
      map.get(t.transactionDate)!.push(t);
    }
    return Array.from(map.entries());
  }, [groupTxns]);

  const periodLabel =
    period === "custom"
      ? `${periodStart} to ${periodEnd}`
      : { "this-month": "This month", last3: "Last 3 months", last6: "Last 6 months" }[period];

  return (
    <div className="px-5 pt-6">
      <h1 className="mb-4 text-[22px] font-bold tracking-tight">Activity</h1>

      <PeriodSelector
        period={period}
        onPeriodChange={setPeriod}
        customStart={customStart}
        customEnd={customEnd}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
      />

      <TopCategoriesCard categories={categorySpend} periodLabel={periodLabel} />

      <div className="mb-4 grid grid-cols-2 gap-2.5">
        <button
          onClick={() => setGroup("SGD")}
          className={cn(
            "rounded-[var(--radius-md)] border p-3.5 text-left",
            group === "SGD" ? "border-primary bg-accent" : "border-border bg-card"
          )}
        >
          <p className={cn("text-[11.5px] font-bold uppercase tracking-wide", group === "SGD" ? "text-primary" : "text-muted-foreground")}>
            SGD spend
          </p>
          <p className="mt-1.5 font-mono text-[18px] font-semibold tabular-nums">SGD {fmt(sgdTotal, 0)}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Across SGD and other non-INR</p>
        </button>
        <button
          onClick={() => setGroup("INR")}
          className={cn(
            "rounded-[var(--radius-md)] border p-3.5 text-left",
            group === "INR" ? "border-primary bg-accent" : "border-border bg-card"
          )}
        >
          <p className={cn("text-[11.5px] font-bold uppercase tracking-wide", group === "INR" ? "text-primary" : "text-muted-foreground")}>
            INR spend
          </p>
          <p className="mt-1.5 font-mono text-[18px] font-semibold tabular-nums">₹{fmt(inrNativeTotal, 0)}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">≈ SGD {fmt(inrSgdTotal, 0)}</p>
        </button>
      </div>

      <div className="relative mb-1">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search item or merchant"
          className="w-full rounded-[var(--radius-md)] border border-border bg-card py-2.5 pl-9 pr-3 text-[13.5px] outline-none focus:border-primary"
        />
      </div>
      <p className="mb-4 text-[11px] text-muted-foreground">
        {q
          ? `Showing matching line items only — not whole receipts.`
          : "Matches merchant, item, and category text across every date in this period."}
      </p>

      {q ? (
        matchedItems.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
            No items match &ldquo;{query}&rdquo; in this period.
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between rounded-[var(--radius-md)] bg-secondary px-3.5 py-2.5">
              <span className="text-[12px] font-semibold text-muted-foreground">
                {matchedItems.length} matching item{matchedItems.length === 1 ? "" : "s"}
              </span>
              <span className="font-mono text-[13.5px] font-bold tabular-nums">
                {group === "INR" ? "₹" : "SGD "}
                {fmt(matchedTotal)}
              </span>
            </div>
            {matchedByDate.map(([date, items]) => (
              <div key={date} className="mb-4">
                <p className="mb-2 text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">
                  {new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" })}
                </p>
                <div className="overflow-hidden rounded-[var(--radius-md)] border border-border bg-card">
                  <div className="grid grid-cols-[1fr_52px_72px] gap-2 bg-secondary px-3 py-2 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
                    <span>Item</span>
                    <span className="text-center">Qty</span>
                    <span className="text-right">Amount</span>
                  </div>
                  {items.map((item, i) => (
                    <button
                      key={item.id}
                      onClick={() => jumpToTransaction(item.txnId)}
                      className={cn(
                        "grid w-full grid-cols-[1fr_52px_72px] gap-2 px-3 py-2.5 text-left text-[12px]",
                        i > 0 && "border-t border-border"
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{highlight(item.description, q)}</p>
                        <p className="truncate text-[10.5px] text-muted-foreground">{highlight(item.merchant, q)}</p>
                        <p className="truncate text-[10.5px] text-muted-foreground">
                          {highlight(categoryPath(item.primaryCategory, item.secondaryCategory), q)}
                        </p>
                      </div>
                      <span className="truncate text-center font-mono text-[11px] text-muted-foreground">{item.qty}</span>
                      <span className="truncate text-right font-mono font-semibold tabular-nums">
                        {item.currency} {fmt(item.itemTotal)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )
      ) : byDate.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
          No transactions match this filter.
        </div>
      ) : (
        byDate.map(([date, txns]) => (
          <div key={date} className="mb-4">
            <p className="mb-2 text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">
              {new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" })}
            </p>
            {txns.map((t) => {
              const isOpen = expanded === t.id;
              return (
                <div
                  key={t.id}
                  id={`txn-${t.id}`}
                  className={cn(
                    "mb-2 overflow-hidden rounded-[var(--radius-md)] border bg-card",
                    t.id === highlightId ? "border-primary" : "border-border"
                  )}
                >
                  <button
                    className="flex w-full items-center gap-3 p-3"
                    onClick={() => setExpanded(isOpen ? null : t.id)}
                    aria-expanded={isOpen}
                  >
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-secondary text-[15px]">🧾</div>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="truncate text-[13.5px] font-semibold">{highlight(t.merchant, q)}</p>
                      <p className="truncate text-[11.5px] text-muted-foreground">
                        {t.primaryCategory} · {t.items.length} item{t.items.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex-none text-right">
                      {t.currencyGroup === "INR" ? (
                        <>
                          <div className="font-mono text-[13.5px] font-semibold tabular-nums">₹{fmt(t.originalAmount)}</div>
                          <div className="font-mono text-[10.5px] text-muted-foreground tabular-nums">≈ SGD {fmt(t.sgdAmount)}</div>
                        </>
                      ) : t.currency === "SGD" ? (
                        <div className="font-mono text-[13.5px] font-semibold tabular-nums">SGD {fmt(t.originalAmount)}</div>
                      ) : (
                        <>
                          <div className="font-mono text-[13.5px] font-semibold tabular-nums">SGD {fmt(t.sgdAmount)}</div>
                          <div className="font-mono text-[10.5px] text-muted-foreground tabular-nums">
                            {t.currency} {fmt(t.originalAmount)}
                          </div>
                        </>
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-border">
                      <div className="grid grid-cols-[1fr_52px_64px] gap-2 bg-secondary px-3 py-2 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
                        <span>Item</span>
                        <span className="text-center">Qty</span>
                        <span className="text-right">Amount</span>
                      </div>
                      {t.items.map((item) => (
                        <div key={item.id} className="grid grid-cols-[1fr_52px_64px] gap-2 border-t border-border px-3 py-2 text-[12px]">
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{highlight(item.description, q)}</p>
                            <p className="truncate text-[10.5px] text-muted-foreground">{categoryPath(item.primaryCategory, item.secondaryCategory)}</p>
                          </div>
                          <span className="truncate text-center font-mono text-[11px] text-muted-foreground">{item.qty}</span>
                          <span className="text-right font-mono font-semibold tabular-nums">{fmt(item.itemTotal)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
