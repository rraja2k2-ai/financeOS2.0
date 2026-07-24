"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Banknote,
  BadgePercent,
  Building2,
  Car,
  Clapperboard,
  GraduationCap,
  HandCoins,
  HeartHandshake,
  HeartPulse,
  Home,
  Lightbulb,
  Package,
  PiggyBank,
  Receipt as ReceiptIcon,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  TrendingUp,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityTransaction } from "@/services/finance/activity.service";
import { computeCategorySpendFromTransactions } from "@/services/finance/activity.service";
import { PeriodSelector } from "@/components/shared/PeriodSelector";
import { TopCategoriesCard } from "@/components/shared/TopCategoriesCard";
import { resolvePeriodRange, startOfMonthIso, todayIso, type PeriodKey } from "@/lib/period";
import { ReviewScreen } from "@/components/capture/ReviewScreen";
import { ReceiptViewer, type ReceiptViewerPage } from "@/components/activity/ReceiptViewer";
import type { CaptureMasterData, CaptureReceiptResult } from "@/services/ai/ai-provider";
import type { ReviewedCapture } from "@/services/capture/save-capture.service";

/** Icon per primary category (constants/categories.ts) — presentation only, falls back to a generic receipt for anything unmapped. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "Cashback & Rewards": BadgePercent,
  "Interest Income": PiggyBank,
  Investments: TrendingUp,
  "Rental Income": Building2,
  Salary: Banknote,
  Education: GraduationCap,
  "Family Support": HeartHandshake,
  "Food & Dining": UtensilsCrossed,
  Groceries: ShoppingBasket,
  Healthcare: HeartPulse,
  Housing: Home,
  "Housing & Utilities": Lightbulb,
  Insurance: ShieldCheck,
  "Leisure & Entertainment": Clapperboard,
  Lending: HandCoins,
  Miscellaneous: Package,
  Shopping: ShoppingBag,
  Transportation: Car,
};

function categoryIcon(primary: string | null): LucideIcon {
  return (primary && CATEGORY_ICONS[primary]) || ReceiptIcon;
}

/**
 * Progressive disclosure for long receipts (UI Refresh v2.0, §5). Receipts at or under
 * the threshold show every item — nothing is ever hidden for a normal-sized receipt.
 * Past it, only DEFAULT_VISIBLE_ITEMS show initially; the gap between the two numbers
 * has to be wide enough that "Show remaining N items" is worth a tap (hiding just one or
 * two items would be pointless), so a 9-item receipt (the first case over the threshold)
 * still hides 3 — a real, worthwhile collapse.
 */
const LONG_RECEIPT_THRESHOLD = 8;
const DEFAULT_VISIBLE_ITEMS = 6;

export type ActivityViewProps = {
  transactions: ActivityTransaction[];
  /** From ?highlight=<id> (Dashboard's Recent Transactions deep link, or post-capture
   *  navigation) — auto-expands and scrolls to this transaction. */
  highlightId?: string;
  /** From ?edit=1 (Fix 7.0 Post-Save Review) — set ONLY by post-capture navigation, never
   *  by Dashboard's Recent Transactions link. When true alongside highlightId, the Edit
   *  screen opens automatically once, right after the expand/highlight, so the user can
   *  immediately correct the already-saved transaction. */
  autoEdit?: boolean;
  /** Powers the (single, reused) Review screen's dropdowns when editing a transaction. */
  masterData: CaptureMasterData;
};

/** An existing transaction opened for editing — fetched on demand, shaped for the SAME ReviewScreen used by Capture. */
type EditingTransaction = {
  headerId: string;
  result: CaptureReceiptResult;
  itemIds: string[];
};

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** "15 Jul 2026" — the receipt/business date, Activity's primary date (Fix 6.4.2). */
function formatFullDate(dateIso: string): string {
  return new Date(dateIso + "T00:00:00").toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/** "20 Jul 2026, 8:42 PM" — the ingestion timestamp, informational only (Fix 6.4.2). */
function formatCapturedAt(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  const timePart = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${datePart}, ${timePart}`;
}

/**
 * Qty is stored free text (Fix 5.2). Weight/volume/etc. units are shown exactly as
 * extracted — never reformatted. Only when no unit is present (a bare piece count, e.g.
 * from a legacy fixed-precision NUMERIC cast like "1.000") do we trim insignificant
 * trailing zeros and apply "PC", FinanceOS's standard default unit of measure. This is
 * presentation-only — the stored qty text is never rewritten.
 */
function formatQty(qty: string): string {
  const trimmed = qty.trim();
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) return trimmed;
  const [, numPart, unitPart] = match;
  if (unitPart.trim()) return trimmed;
  const cleanedNum = numPart.includes(".") ? numPart.replace(/0+$/, "").replace(/\.$/, "") || "0" : numPart;
  return `${cleanedNum} PC`;
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

export function ActivityView({ transactions, highlightId, autoEdit, masterData }: ActivityViewProps) {
  const router = useRouter();
  const highlightedTxn = highlightId ? transactions.find((t) => t.id === highlightId) : undefined;

  // A highlighted transaction might be outside "this month" or the default SGD group —
  // widen the filters up front so it's actually visible rather than silently filtered out.
  const [period, setPeriod] = useState<PeriodKey>(highlightedTxn ? "last6" : "this-month");
  const [customStart, setCustomStart] = useState(startOfMonthIso());
  const [customEnd, setCustomEnd] = useState(todayIso());
  const [group, setGroup] = useState<"SGD" | "INR">(highlightedTxn?.currencyGroup ?? "SGD");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(highlightId ?? null);
  // The visual highlight fades after ~3s; the transaction stays expanded. Separate from
  // `expanded` itself so re-collapsing never happens automatically — only the emphasis does.
  const [highlightActive, setHighlightActive] = useState(!!highlightId);
  // Long-receipt progressive disclosure (UI Refresh v2.0, §5) — which transactions the
  // user has asked to see in full. Presentation-only; resets naturally on a fresh filter.
  const [expandedItemsFor, setExpandedItemsFor] = useState<Set<string>>(new Set());
  // Post-Save Review (Fix 7.0): tracks which highlightId auto-edit has already fired for,
  // so an unrelated re-render (e.g. router.refresh() from an inbox-changed event) never
  // reopens Edit after the user has closed it. Reset only when highlightId itself changes.
  const autoEditFiredRef = useRef<string | null>(null);

  // Edit & Delete (Fix 3) — the transaction header's own actions, not the line items'.
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingTransaction | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Header overflow menu (UX refresh Phase C) + Receipt Viewer (Phase D). The menu
  // renders through a portal (Fix 5.3) so it's never clipped by the transaction card's
  // overflow-hidden — position is computed from the trigger button's own rect, not CSS.
  const [menuAnchor, setMenuAnchor] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [receiptLoadingId, setReceiptLoadingId] = useState<string | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<ReceiptViewerPage[] | null>(null);

  // A floating, position-computed menu goes stale if the page scrolls or resizes under
  // it — simplest correct behavior is to just close it rather than re-track position.
  useEffect(() => {
    if (!menuAnchor) return;
    function close() {
      setMenuAnchor(null);
    }
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menuAnchor]);

  // Re-runs when highlightId itself changes, not on every render — required for the
  // post-capture flow, where a background capture can navigate here (?highlight=<id>)
  // while ActivityView is already mounted (the user was already on this page). Widens
  // period/group for the same reason the initial state does: the newly highlighted
  // transaction may fall outside whatever the user currently has selected.
  //
  // Deliberately depends on highlightId ONLY, not transactions: the server already
  // guarantees the highlighted transaction is present in `transactions` on the very
  // render that introduces a given highlightId (getActivityWithHighlight, Fix 7.0), so
  // this never needs to "wait and retry" as transactions updates later. If transactions
  // were a dependency, any later router.refresh() with the same highlightId still in the
  // URL (e.g. after deleting or editing an unrelated transaction) would re-run this
  // effect and forcibly re-expand/re-scroll/reset the period — exactly the bug this
  // fixes: Activity state must only change because of what the user just did, not
  // because of a stale highlight from earlier in the session.
  useEffect(() => {
    if (!highlightId) return;
    const txn = transactions.find((t) => t.id === highlightId);
    if (txn) {
      setPeriod("last6");
      setGroup(txn.currencyGroup);
    }
    setExpanded(highlightId);
    setHighlightActive(true);
    requestAnimationFrame(() => {
      document.getElementById(`txn-${highlightId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timer = setTimeout(() => setHighlightActive(false), 3000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- transactions intentionally excluded, see comment above.
  }, [highlightId]);

  // Post-Save Review (Fix 7.0): right after a successful capture, Activity doesn't just
  // expand and highlight the new transaction — it opens Edit for it automatically too,
  // since the transaction is already saved and this is purely a fast correction pass, not
  // a gate. Fires once per highlightId (not on every re-render); Dashboard's Recent
  // Transactions link never sets autoEdit, so clicking an existing transaction there never
  // force-opens Edit — only a fresh capture does.
  useEffect(() => {
    if (!autoEdit || !highlightId) return;
    if (autoEditFiredRef.current === highlightId) return;
    autoEditFiredRef.current = highlightId;
    handleEdit(highlightId);
  }, [autoEdit, highlightId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Auto-save (Phase F) happens in the background, outside any request this page is
  // part of — refresh when the global Inbox indicator signals a capture just finished
  // (same event enqueue/retry/delete already dispatch), so a newly saved transaction
  // shows up without the user manually reloading.
  useEffect(() => {
    function onChanged() {
      router.refresh();
    }
    window.addEventListener("financeos:inbox-changed", onChanged);
    return () => window.removeEventListener("financeos:inbox-changed", onChanged);
  }, [router]);

  /** Loads the existing transaction and opens the SAME Review screen used by Capture, in edit mode. */
  async function handleEdit(txnId: string) {
    setActionError(null);
    setEditLoadingId(txnId);
    try {
      const res = await fetch(`/api/transactions/${txnId}`);
      const body = (await res.json().catch(() => null)) as { result?: CaptureReceiptResult; itemIds?: string[]; error?: string } | null;
      if (!res.ok || !body?.result || !body?.itemIds) {
        setActionError(body?.error ?? "Couldn't load this transaction. Try again.");
        return;
      }
      setEditing({ headerId: txnId, result: body.result, itemIds: body.itemIds });
    } catch {
      setActionError("Couldn't reach the server. Try again.");
    } finally {
      setEditLoadingId(null);
    }
  }

  /** Saves Review edits back onto the SAME transaction (UPDATE, never a new one). */
  async function handleEditSave(reviewed: ReviewedCapture) {
    if (!editing) return;
    const res = await fetch(`/api/transactions/${editing.headerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewed, itemIds: editing.itemIds }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);

    const body = res ? ((await res.json().catch(() => null)) as { updated?: boolean; error?: string } | null) : null;
    if (!res || !res.ok || !body?.updated) {
      throw new Error(body?.error ?? "Couldn't save changes. Your edits are safe — please try again.");
    }

    setEditing(null);
    setToast("Transaction updated.");
    router.refresh();
  }

  async function handleDelete(txnId: string) {
    setActionError(null);
    setDeleteBusyId(txnId);
    try {
      const res = await fetch(`/api/transactions/${txnId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setActionError(body?.error ?? "Couldn't delete this transaction. Try again.");
        return;
      }
      setToast("Transaction deleted.");
      if (expanded === txnId) setExpanded(null);
      router.refresh();
    } catch {
      setActionError("Couldn't reach the server. Try again.");
    } finally {
      setDeleteBusyId(null);
      setConfirmingDeleteId(null);
    }
  }

  /** Loads signed URLs for the transaction's stored receipt pages and opens the full-screen viewer. */
  async function handleViewReceipt(txnId: string) {
    setActionError(null);
    setReceiptLoadingId(txnId);
    try {
      const res = await fetch(`/api/transactions/${txnId}/receipt`);
      const body = (await res.json().catch(() => null)) as { pages?: ReceiptViewerPage[]; error?: string } | null;
      if (!res.ok || !body?.pages) {
        setActionError(body?.error ?? "Couldn't load the receipt. Try again.");
        return;
      }
      if (body.pages.length === 0) {
        setActionError("No receipt was attached to this transaction.");
        return;
      }
      setViewingReceipt(body.pages);
    } catch {
      setActionError("Couldn't reach the server. Try again.");
    } finally {
      setReceiptLoadingId(null);
    }
  }

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

  // groupTxns is already sorted newest-receipt-date-first (activity.service.ts), so the
  // Map's insertion order — and therefore this date grouping — stays newest first too.
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
    <div className="px-5 pt-6" onClick={() => setMenuAnchor(null)}>
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
                  {items.map((item, i) => (
                    <button
                      key={item.id}
                      onClick={() => jumpToTransaction(item.txnId)}
                      className={cn(
                        "flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left text-[12px]",
                        i > 0 && "border-t border-border"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground">{highlight(item.description, q)}</p>
                        <p className="mt-0.5 text-[10.5px] text-muted-foreground">{highlight(item.merchant, q)}</p>
                        <p className="mt-0.5 text-[10.5px]">
                          {formatQty(item.qty) && <span className="font-medium text-primary">{formatQty(item.qty)} </span>}
                          <span className="text-muted-foreground">
                            {formatQty(item.qty) ? "| " : ""}
                            {highlight(categoryPath(item.primaryCategory, item.secondaryCategory), q)}
                          </span>
                        </p>
                      </div>
                      <span className="flex-none text-right font-mono font-semibold tabular-nums">
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
              const Icon = categoryIcon(t.primaryCategory);
              const showAllItems = expandedItemsFor.has(t.id);
              const isLongReceipt = t.items.length > LONG_RECEIPT_THRESHOLD;
              const visibleItems = isLongReceipt && !showAllItems ? t.items.slice(0, DEFAULT_VISIBLE_ITEMS) : t.items;
              const hiddenCount = t.items.length - visibleItems.length;
              return (
                <div
                  key={t.id}
                  id={`txn-${t.id}`}
                  className={cn(
                    "mb-2.5 overflow-hidden rounded-[var(--radius-lg)] border bg-card shadow-md transition-colors duration-700",
                    t.id === highlightId && highlightActive ? "border-primary" : "border-border"
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Header — one continuous surface with the body below it (UI Refresh v2.0):
                      hierarchy comes from typography and spacing, not a separate background
                      block. Merchant and amount are the two strongest elements on the card. */}
                  <div className="relative">
                    <button
                      className="flex w-full items-center gap-3 p-3.5 pr-11 text-left transition-transform active:scale-[0.99] motion-reduce:transition-none"
                      onClick={() => setExpanded(isOpen ? null : t.id)}
                      aria-expanded={isOpen}
                    >
                      <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[var(--radius-md)] bg-secondary text-muted-foreground">
                        <Icon size={18} strokeWidth={2} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15.5px] font-bold leading-tight">{highlight(t.merchant, q)}</p>
                        <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                          {t.primaryCategory} · {t.items.length} item{t.items.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex-none text-right">
                        {t.currencyGroup === "INR" ? (
                          <>
                            <div className="font-mono text-[17px] font-bold tabular-nums">₹{fmt(t.originalAmount)}</div>
                            <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground tabular-nums">≈ SGD {fmt(t.sgdAmount)}</div>
                          </>
                        ) : t.currency === "SGD" ? (
                          <div className="font-mono text-[17px] font-bold tabular-nums">SGD {fmt(t.originalAmount)}</div>
                        ) : (
                          <>
                            <div className="font-mono text-[17px] font-bold tabular-nums">SGD {fmt(t.sgdAmount)}</div>
                            <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground tabular-nums">
                              {t.currency} {fmt(t.originalAmount)}
                            </div>
                          </>
                        )}
                      </div>
                    </button>

                    {/* Header-level actions — a single overflow menu, top-right of the transaction header. */}
                    <button
                      type="button"
                      aria-label="Transaction actions"
                      title="Transaction actions"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (menuAnchor?.id === t.id) {
                          setMenuAnchor(null);
                          return;
                        }
                        setMenuAnchor({ id: t.id, rect: e.currentTarget.getBoundingClientRect() });
                      }}
                      className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="5" r="1.8" />
                        <circle cx="12" cy="12" r="1.8" />
                        <circle cx="12" cy="19" r="1.8" />
                      </svg>
                    </button>
                  </div>

                  {/* Expanded items — a supporting timeline, not a nested card: single shared
                      background, thin dividers, and a vertical accent line tying the rows
                      together instead of numbering. Fades in on open (UI Refresh v2.0 motion);
                      collapse stays instant — the direction that actually needs the reassurance
                      is content appearing, not disappearing. */}
                  {isOpen && (
                    <div className="animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none border-t border-border/60">
                      {/* Receipt Date + Captured — one compact line instead of a two-line
                          block (UI Refresh v2.0 §3): both dates preserved, just laid out
                          inline. Receipt Date is the primary business date; Captured
                          (ingestion time) stays informational only (Fix 6.4.2). */}
                      <div className="flex flex-wrap items-baseline gap-x-1.5 border-b border-border/60 px-3.5 py-2 text-[11px] text-muted-foreground">
                        <span>
                          Receipt <span className="font-semibold text-foreground">{formatFullDate(t.transactionDate)}</span>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Captured <span className="font-semibold text-foreground">{formatCapturedAt(t.capturedAt)}</span>
                        </span>
                      </div>
                      <div className="relative pl-4">
                        <div className="absolute bottom-0 left-[15px] top-0 w-px bg-primary/25" aria-hidden="true" />
                        {visibleItems.map((item, i) => (
                          <div key={item.id} className={cn("relative py-2.5 pr-3", i > 0 && "border-t border-border/60")}>
                            <span className="absolute left-[-8.5px] top-[16px] h-[7px] w-[7px] rounded-full bg-primary" aria-hidden="true" />
                            <div className="flex items-start justify-between gap-3 text-[12.5px]">
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-foreground">{highlight(item.description, q)}</p>
                                <div className="mt-1 flex items-center gap-1.5">
                                  {formatQty(item.qty) && (
                                    <span className="flex-none rounded-full bg-primary/15 px-1.5 py-[1px] font-mono text-[10px] font-semibold text-primary">
                                      {formatQty(item.qty)}
                                    </span>
                                  )}
                                  <span className="truncate text-[10.5px] text-muted-foreground">
                                    {categoryPath(item.primaryCategory, item.secondaryCategory)}
                                  </span>
                                </div>
                              </div>
                              <span className="flex-none text-right font-mono font-semibold tabular-nums">{fmt(item.itemTotal)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      {hiddenCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpandedItemsFor((prev) => new Set(prev).add(t.id))}
                          className="block w-full border-t border-dashed border-border/60 py-2.5 pl-[27px] pr-3.5 text-left text-[12px] font-semibold text-primary"
                        >
                          Show remaining {hiddenCount} item{hiddenCount === 1 ? "" : "s"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}

      {actionError && <p className="mt-3 text-[12px] font-semibold text-destructive">{actionError}</p>}

      {/* Header overflow menu — rendered through a portal so a short card (one line item,
          or none) can never clip it via the card's own overflow-hidden. Position is the
          trigger button's own rect, not a CSS-relative offset. */}
      {menuAnchor &&
        createPortal(
          <div
            className="fixed z-[85] w-44 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card shadow-lg"
            style={{ top: menuAnchor.rect.bottom + 4, left: Math.max(8, menuAnchor.rect.right - 176) }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              disabled={editLoadingId === menuAnchor.id}
              onClick={() => {
                const id = menuAnchor.id;
                setMenuAnchor(null);
                handleEdit(id);
              }}
              className="block w-full px-3.5 py-2.5 text-left text-[12.5px] font-semibold disabled:opacity-50"
            >
              {editLoadingId === menuAnchor.id ? "Loading…" : "Edit"}
            </button>
            <button
              type="button"
              disabled={receiptLoadingId === menuAnchor.id}
              onClick={() => {
                const id = menuAnchor.id;
                setMenuAnchor(null);
                handleViewReceipt(id);
              }}
              className="block w-full border-t border-border px-3.5 py-2.5 text-left text-[12.5px] font-semibold disabled:opacity-50"
            >
              {receiptLoadingId === menuAnchor.id ? "Loading…" : "View Receipt"}
            </button>
            <button
              type="button"
              onClick={() => {
                const id = menuAnchor.id;
                setMenuAnchor(null);
                setActionError(null);
                setConfirmingDeleteId(id);
              }}
              className="block w-full border-t border-border px-3.5 py-2.5 text-left text-[12.5px] font-semibold text-destructive"
            >
              Delete
            </button>
          </div>,
          document.body
        )}

      {/* Edit — the SAME Review screen used by Capture, populated from the saved transaction. Save UPDATEs it, never creates a new one. */}
      {editing && (
        <ReviewScreen
          result={editing.result}
          masterData={masterData}
          onCancel={() => setEditing(null)}
          onSave={handleEditSave}
        />
      )}

      {/* View Receipt — reuses the stored original file(s), read-only. */}
      {viewingReceipt && <ReceiptViewer pages={viewingReceipt} onClose={() => setViewingReceipt(null)} />}

      {/* Delete confirmation */}
      {confirmingDeleteId && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-8" role="alertdialog" aria-label="Delete this transaction?">
          <div className="w-full max-w-[340px] rounded-[var(--radius-lg)] border border-border bg-card p-5">
            <p className="text-[14.5px] font-bold">Delete this transaction?</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">This action cannot be undone.</p>
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmingDeleteId(null)}
                disabled={deleteBusyId === confirmingDeleteId}
                className="flex-1 rounded-lg border border-border py-2 text-[13px] font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmingDeleteId)}
                disabled={deleteBusyId === confirmingDeleteId}
                className="flex-1 rounded-lg bg-destructive py-2 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {deleteBusyId === confirmingDeleteId ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed inset-x-0 z-[80] mx-auto w-fit max-w-[90%] rounded-full bg-foreground px-4 py-2.5 text-[13px] font-semibold text-background shadow-lg"
          style={{ bottom: "calc(96px + env(safe-area-inset-bottom, 0px))" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
