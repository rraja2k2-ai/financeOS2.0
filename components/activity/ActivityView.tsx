"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ActivityTransaction } from "@/services/finance/activity.service";
import { computeCategorySpendFromTransactions } from "@/services/finance/activity.service";
import { PeriodSelector } from "@/components/shared/PeriodSelector";
import { TopCategoriesCard } from "@/components/shared/TopCategoriesCard";
import { categoryActivityHref, resolvePeriodRange, startOfMonthIso, todayIso, type PeriodKey } from "@/lib/period";
import { ReviewScreen } from "@/components/capture/ReviewScreen";
import { ReceiptViewer, type ReceiptViewerPage } from "@/components/activity/ReceiptViewer";
import { TransactionDetailView } from "@/components/activity/TransactionDetailView";
import { TransactionCard } from "@/components/activity/TransactionCard";
import { fmt } from "@/components/activity/activity-format";
import { FilteredLineItemList, filterLineItems, type FilteredLineItem } from "@/components/activity/FilteredLineItemList";
import { useTransactionEditor } from "@/hooks/useTransactionEditor";
import { useOverflowMenu } from "@/hooks/useOverflowMenu";
import { isExpenseTransaction } from "@/lib/expense-filter";
import { deleteTransactionRequest, fetchReceiptPagesRequest } from "@/lib/transaction-actions";
import type { CaptureMasterData } from "@/services/ai/ai-provider";

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
  /** From ?account=<id> (Account Detail's Recent Transactions / See All Transactions
   *  cross-link) — narrows the list to just this account's transactions. */
  accountId?: string;
  /** Display name for the account filter chip — looked up server-side since ActivityView
   *  otherwise never needs account master data. */
  accountName?: string;
  /** From ?period=<key> (Account Detail cross-link) — the period the user had selected
   *  there, auto-applied here instead of Activity's own highlight-driven default. */
  initialPeriod?: PeriodKey;
  initialCustomStart?: string;
  initialCustomEnd?: string;
  /** From ?category=<primary> (Dashboard's Top Categories drill-down) — narrows the list
   *  to transactions with at least one item in this primary category. */
  categoryFilter?: string;
  /** From ?subcategory=<secondary> — only meaningful alongside categoryFilter; narrows
   *  further to items matching both primary and secondary category. */
  subcategoryFilter?: string;
  /** id -> account_name, loaded once server-side (Transaction UX Final Polish) — powers
   *  the type-aware transaction title ("POSB Bank → MariBank" for an internal transfer),
   *  see activity-format.tsx's transactionTitle(). */
  accountNameById: Record<string, string>;
};

export function ActivityView({
  transactions,
  highlightId,
  autoEdit,
  masterData,
  accountId,
  accountName,
  initialPeriod,
  initialCustomStart,
  initialCustomEnd,
  categoryFilter,
  subcategoryFilter,
  accountNameById,
}: ActivityViewProps) {
  const router = useRouter();
  const highlightedTxn = highlightId ? transactions.find((t) => t.id === highlightId) : undefined;

  // A highlighted transaction might be outside "this month" or the default SGD group —
  // widen the filters up front so it's actually visible rather than silently filtered out.
  // Account Detail's cross-link always passes its own already-correct period explicitly
  // (initialPeriod), so that wins over the highlight-driven default instead of being
  // silently overridden — see CLAUDE.md §7's "Period ... auto-applied" requirement.
  const [period, setPeriod] = useState<PeriodKey>(initialPeriod ?? (highlightedTxn ? "last6" : "this-month"));
  const [customStart, setCustomStart] = useState(initialCustomStart || startOfMonthIso());
  const [customEnd, setCustomEnd] = useState(initialCustomEnd || todayIso());
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
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Edit itself (fetch/save/delete orchestration) is shared via useTransactionEditor
  // (Transaction Workspace Foundation) — the same hook Dashboard and Account Detail use.
  const {
    editing,
    loadingId: editLoadingId,
    openEditor: handleEdit,
    closeEditor,
    saveEditor,
    deleteEditor,
  } = useTransactionEditor({
    masterData,
    onSaved: () => {
      setToast("Transaction updated.");
      router.refresh();
    },
    onDeleted: () => {
      setToast("Transaction deleted.");
      router.refresh();
    },
    onError: setActionError,
  });

  // Introduce Transaction Details (Read-Only) — "Browsing = Transaction Details,
  // Editing = Transaction Workspace". Both screens read the SAME `editing` data
  // useTransactionEditor already fetches (result/itemIds/capturedAt/masterData); this
  // just toggles which of the two presentations is shown over it, so switching between
  // them (Edit, or Back from Workspace) never refetches anything.
  const [detailMode, setDetailMode] = useState<"view" | "edit" | null>(null);

  /** Every normal browsing entry point (overflow menu, Search result, Category Filter
   *  row) opens read-only Details first — never the Workspace directly. */
  function openDetails(txnId: string) {
    setDetailMode("view");
    handleEdit(txnId);
  }

  function closeDetails() {
    setDetailMode(null);
    closeEditor();
  }

  // Header overflow menu (UX refresh Phase C) + Receipt Viewer (Phase D). The menu
  // renders through a portal (Fix 5.3) so it's never clipped by the transaction card's
  // overflow-hidden — position is computed from the trigger button's own rect, not CSS.
  // Escape/click-outside/scroll-resize-close all live in the shared hook now (Transaction
  // UX Final Polish, Part 4) — never duplicated per screen.
  const { anchor: menuAnchor, toggle: toggleMenu, close: closeMenu } = useOverflowMenu();
  const [receiptLoadingId, setReceiptLoadingId] = useState<string | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<ReceiptViewerPage[] | null>(null);

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
      // Account Detail's cross-link already picked a period that contains this
      // transaction (it's the very account+period that surfaced it) — only Activity's
      // own deep links (Dashboard, no accountId) need the "widen to last6" rescue.
      if (!accountId) setPeriod("last6");
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
  }, [highlightId, accountId]);

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
    // Post-Save Review goes straight to the Workspace, bypassing Details — this is a
    // deliberate one-time correction pass right after a fresh capture, not browsing.
    setDetailMode("edit");
    handleEdit(highlightId);
  }, [autoEdit, highlightId, handleEdit]);

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

  async function handleDelete(txnId: string) {
    setActionError(null);
    setDeleteBusyId(txnId);
    const result = await deleteTransactionRequest(txnId);
    if (!result.ok) {
      setActionError(result.error);
    } else {
      setToast("Transaction deleted.");
      if (expanded === txnId) setExpanded(null);
      router.refresh();
    }
    setDeleteBusyId(null);
    setConfirmingDeleteId(null);
  }

  /** Loads signed URLs for the transaction's stored receipt pages and opens the full-screen viewer. */
  async function handleViewReceipt(txnId: string) {
    setActionError(null);
    setReceiptLoadingId(txnId);
    const result = await fetchReceiptPagesRequest(txnId);
    if (!result.ok) {
      setActionError(result.error);
    } else {
      setViewingReceipt(result.pages);
    }
    setReceiptLoadingId(null);
  }

  const { start: periodStart, end: periodEnd } = resolvePeriodRange(period, customStart, customEnd);

  const inPeriod = useMemo(
    () =>
      transactions.filter(
        (t) =>
          t.transactionDate >= periodStart &&
          t.transactionDate <= periodEnd &&
          // Bug Fix (Account Details / Activity Filter Consistency) — must match Account
          // Detail's own listByAccountId() query (source OR target), the same two columns
          // the Posting Engine posts against, or a Transfer visible in an account's Recent
          // Transactions would vanish from "See All Transactions" (which filters this same
          // client-side list by accountId).
          (!accountId || t.sourceAccountId === accountId || t.targetAccountId === accountId) &&
          (!categoryFilter ||
            t.items.some((it) => it.primaryCategory === categoryFilter && (!subcategoryFilter || it.secondaryCategory === subcategoryFilter)))
      ),
    [transactions, periodStart, periodEnd, accountId, categoryFilter, subcategoryFilter]
  );

  const categorySpend = useMemo(() => computeCategorySpendFromTransactions(inPeriod), [inPeriod]);

  const sgdGroupTxns = inPeriod.filter((t) => t.currencyGroup === "SGD");
  const inrGroupTxns = inPeriod.filter((t) => t.currencyGroup === "INR");

  // "SGD/INR Spend" is expense analytics, not a transaction count — TRANSFER (and any
  // other non-expense type) moves money between accounts/liabilities, it isn't spend.
  // The transaction LIST below still shows every type (sgdGroupTxns/inrGroupTxns stay
  // unfiltered for that); only these three totals exclude non-expense rows, reusing the
  // exact same classifier category-spend.service.ts/Dashboard/Budget already use — see
  // lib/expense-filter.ts (Transaction UX Final Polish, Part 1).
  const isExpenseHeader = (t: ActivityTransaction) => isExpenseTransaction({ transaction_type: t.transactionType, primary_category: t.primaryCategory });
  const sgdTotal = sgdGroupTxns.filter(isExpenseHeader).reduce((sum, t) => sum + t.sgdAmount, 0);
  const inrNativeTotal = inrGroupTxns.filter(isExpenseHeader).reduce((sum, t) => sum + t.originalAmount, 0);
  const inrSgdTotal = inrGroupTxns.filter(isExpenseHeader).reduce((sum, t) => sum + t.sgdAmount, 0);

  const groupTxns = group === "SGD" ? sgdGroupTxns : inrGroupTxns;
  const q = query.trim().toLowerCase();

  // Unify Filtered Line Item Experience — "Filtering = Line Items" (design principle):
  // both Search and Category Filter flatten groupTxns down to individual matching line
  // items via the same shared filterLineItems() (FilteredLineItemList.tsx), differing
  // only in their predicate. groupTxns is already category-filtered upstream (inPeriod
  // above), so a "milk" search while a category chip is active still only searches
  // within that category — never a separate, conflicting narrowing step.
  const matchedItems: FilteredLineItem[] = useMemo(() => {
    if (!q) return [];
    return filterLineItems(
      groupTxns,
      (item, t) =>
        (item.description ?? "").toLowerCase().includes(q) ||
        (item.primaryCategory ?? "").toLowerCase().includes(q) ||
        (item.secondaryCategory ?? "").toLowerCase().includes(q) ||
        (t.merchant ?? "").toLowerCase().includes(q)
    );
  }, [groupTxns, q]);

  const categoryFilteredItems: FilteredLineItem[] = useMemo(() => {
    if (!categoryFilter || q) return [];
    return filterLineItems(
      groupTxns,
      (item) => item.primaryCategory === categoryFilter && (!subcategoryFilter || item.secondaryCategory === subcategoryFilter)
    );
  }, [groupTxns, categoryFilter, subcategoryFilter, q]);

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
      : { "this-month": "This month", "last-month": "Last month", last3: "Last 3 months", last6: "Last 6 months", "this-year": "This year" }[
          period
        ];

  return (
    <div className="px-5 pt-6">
      <h1 className="mb-4 text-[22px] font-bold tracking-tight">Activity</h1>

      {accountId && (
        <div className="mb-4 flex items-center justify-between rounded-[var(--radius-md)] border border-border bg-secondary/40 px-3.5 py-2.5 text-[12px] font-semibold">
          <span>Showing {accountName ?? "one account"} only</span>
          <Link href="/activity" className="text-primary">
            Clear
          </Link>
        </div>
      )}

      {categoryFilter && (
        <div className="mb-4 flex items-center justify-between rounded-[var(--radius-md)] border border-border bg-secondary/40 px-3.5 py-2.5 text-[12px] font-semibold">
          <span>
            Showing {categoryFilter}
            {subcategoryFilter ? ` → ${subcategoryFilter}` : ""} only
          </span>
          <Link href="/activity" className="text-primary">
            Clear
          </Link>
        </div>
      )}

      <PeriodSelector
        period={period}
        onPeriodChange={setPeriod}
        customStart={customStart}
        customEnd={customEnd}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
      />

      <TopCategoriesCard
        categories={categorySpend}
        periodLabel={periodLabel}
        onDrilldown={({ primaryCategory, secondaryCategory }) =>
          router.push(categoryActivityHref({ primaryCategory, secondaryCategory, period, customStart, customEnd }))
        }
      />

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
        <FilteredLineItemList
          items={matchedItems}
          emptyMessage={`No items match "${query}" in this period.`}
          query={q}
          onOpenItem={openDetails}
        />
      ) : categoryFilter ? (
        <FilteredLineItemList items={categoryFilteredItems} emptyMessage="No items match this category filter." onOpenItem={openDetails} />
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
            {txns.map((t) => (
              <TransactionCard
                key={t.id}
                transaction={t}
                query={q}
                isOpen={expanded === t.id}
                onToggle={() => setExpanded(expanded === t.id ? null : t.id)}
                isHighlighted={t.id === highlightId && highlightActive}
                showActions
                onActionsClick={(rect) => toggleMenu(t.id, rect)}
                accountNameById={accountNameById}
                showAllItems={expandedItemsFor.has(t.id)}
                onShowAllItems={() => setExpandedItemsFor((prev) => new Set(prev).add(t.id))}
              />
            ))}
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
                closeMenu();
                openDetails(id);
              }}
              className="block w-full px-3.5 py-2.5 text-left text-[12.5px] font-semibold disabled:opacity-50"
            >
              {editLoadingId === menuAnchor.id ? "Loading…" : "View Details"}
            </button>
            <button
              type="button"
              disabled={receiptLoadingId === menuAnchor.id}
              onClick={() => {
                const id = menuAnchor.id;
                closeMenu();
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
                closeMenu();
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

      {/* Transaction Details (Read-Only) — the universal drill-down destination (Introduce
          Transaction Details milestone): every browsing entry point above (overflow menu,
          Search result, Category Filter row) opens this first. Its own "Edit" button
          switches detailMode to "edit", rendering the Workspace below on the SAME already-
          fetched `editing` data — no refetch, and Back from the Workspace returns here
          (detailMode -> "view") rather than closing outright. */}
      {editing && detailMode === "view" && (
        <TransactionDetailView
          result={editing.result}
          capturedAt={editing.capturedAt}
          headerId={editing.headerId}
          onBack={closeDetails}
          onEdit={() => setDetailMode("edit")}
        />
      )}

      {/* Transaction Workspace (Edit) — the SAME Review screen used by Capture, populated
          from the saved transaction. Save UPDATEs it, never creates a new one. Delete
          (Transaction Workspace Foundation) is a second way to remove a transaction,
          alongside this card's own quick-delete (confirmingDeleteId/handleDelete) above —
          both end up calling the same DELETE API. */}
      {editing && detailMode === "edit" && (
        <ReviewScreen
          result={editing.result}
          masterData={masterData}
          capturedAt={editing.capturedAt}
          headerId={editing.headerId}
          itemIds={editing.itemIds}
          onCancel={() => setDetailMode("view")}
          onSave={saveEditor}
          onDelete={deleteEditor}
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
