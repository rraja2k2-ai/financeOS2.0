"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Receipt as ReceiptTypeIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NetCashPosition } from "@/services/finance/net-cash.service";
import type { RecentTransaction } from "@/services/finance/activity.service";
import type { AttentionItem, BudgetPace } from "@/services/finance/dashboard.service";
import { categoryIcon } from "@/constants/category-icons";
import { TRANSACTION_TYPES } from "@/constants/transaction-types";
import { sourceAccountSubline, subtitleCategory, transactionTitle } from "@/components/activity/activity-format";
import { ReviewScreen } from "@/components/capture/ReviewScreen";
import { ReceiptViewer, type ReceiptViewerPage } from "@/components/activity/ReceiptViewer";
import { useTransactionEditor } from "@/hooks/useTransactionEditor";
import { useOverflowMenu } from "@/hooks/useOverflowMenu";
import { deleteTransactionRequest, fetchReceiptPagesRequest } from "@/lib/transaction-actions";

export type DashboardViewProps = {
  monthLabel: string;
  netCash: NetCashPosition;
  budget: {
    budgetedSgd: number;
    spentSgd: number;
    isCarriedForward: boolean;
    sourceMonth: string | null;
  } | null;
  /** Income minus Expense for the current month (Dashboard v1.4 Decision Dashboard) —
   *  already computed server-side (services/finance/dashboard.service.ts). */
  estimatedMonthlySavings: number;
  /** "Day 15 of 30, expected 50%, actual 42%" — null when there's no budget to pace
   *  against (no Generic project configured), same condition the budget ring already
   *  guards on. */
  budgetPace: BudgetPace | null;
  /** Conditional Attention section (Dashboard v1.4) — empty means nothing needs
   *  attention; the section is hidden entirely in that case, never an empty-state message. */
  attentionItems: AttentionItem[];
  recentTransactions: RecentTransaction[];
  /** id -> account_name (Transaction UX Final Polish) — see activity-format.tsx's transactionTitle(). */
  accountNameById: Record<string, string>;
};

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function DashboardView({
  monthLabel,
  netCash,
  budget,
  estimatedMonthlySavings,
  budgetPace,
  attentionItems,
  recentTransactions: initialRecentTransactions,
  accountNameById,
}: DashboardViewProps) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);

  // Local copy so a saved Edit can patch just the one affected card (§4/§8 — no
  // router.refresh(), no re-querying the rest of the Dashboard's data).
  const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>(initialRecentTransactions);
  // Escape/click-outside/scroll-resize-close all live in the shared hook (Transaction UX
  // Final Polish, Part 4) — never duplicated per screen.
  const { anchor: menuAnchor, toggle: toggleMenu, close: closeMenu } = useOverflowMenu();
  const [actionError, setActionError] = useState<string | null>(null);
  // View Receipt / Delete (Part 5) — same handlers/requests as Activity's own menu, via
  // lib/transaction-actions.ts, never a second copy of the fetch logic.
  const [receiptLoadingId, setReceiptLoadingId] = useState<string | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<ReceiptViewerPage[] | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  // Edit/Save/Delete orchestration (fetch master data lazily, fetch the transaction, save,
  // delete) is shared via useTransactionEditor (Transaction Workspace Foundation) — the
  // same hook Activity and Account Detail use. Master data isn't passed in (unlike
  // Activity's server-loaded copy) — the hook lazy-fetches it itself on first Edit, same
  // as this screen already did (§8 Performance: not eagerly on every Dashboard visit).
  const {
    masterData,
    editing,
    loadingId: editLoadingId,
    openEditor: handleEdit,
    closeEditor,
    saveEditor,
    deleteEditor,
  } = useTransactionEditor({
    onSaved: (updated) => {
      if (updated) setRecentTransactions((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    },
    onDeleted: (headerId) => {
      setRecentTransactions((prev) => prev.filter((t) => t.id !== headerId));
    },
    onError: setActionError,
  });

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

  async function handleDelete(txnId: string) {
    setActionError(null);
    setDeleteBusyId(txnId);
    const result = await deleteTransactionRequest(txnId);
    if (!result.ok) {
      setActionError(result.error);
    } else {
      setRecentTransactions((prev) => prev.filter((t) => t.id !== txnId));
    }
    setDeleteBusyId(null);
    setConfirmingDeleteId(null);
  }

  const pct = budget && budget.budgetedSgd > 0 ? Math.min(100, Math.round((budget.spentSgd / budget.budgetedSgd) * 100)) : null;

  return (
    <div className="px-5 pt-6">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{today()}</p>
          <h1 className="text-[22px] font-bold tracking-tight">Good day, Raja</h1>
        </div>
        <button
          onClick={() => setHidden((h) => !h)}
          aria-pressed={hidden}
          aria-label="Hide amounts"
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground",
            hidden && "border-primary text-primary"
          )}
        >
          {hidden ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.6 18.6 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19" />
              <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24M1 1l22 22" />
            </svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>

      {/* Today's Pulse */}
      <section className="mb-6">
        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Today&apos;s pulse</p>

        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-[18px]">
          <p className="text-[12.5px] font-semibold text-muted-foreground">Net cash position</p>
          <p className={cn("mt-1.5 font-mono text-[34px] font-semibold tracking-tight tabular-nums", hidden && "blur-md select-none")}>
            <span className="mr-1.5 font-sans text-[16px] font-semibold text-muted-foreground">SGD</span>
            {fmt(netCash.sgdTotal)}
          </p>
          {netCash.unconvertedCurrencies.length > 0 && (
            <p className="mt-1 text-[11px] text-amber">
              Excludes {netCash.unconvertedCurrencies.join(", ")} — no exchange rate on file yet.
            </p>
          )}

          <div className={cn("mt-4 flex gap-2 overflow-x-auto", hidden && "blur-sm select-none")}>
            {netCash.byCurrency.map((c) => (
              <div key={c.currency} className="flex flex-none items-baseline gap-1.5 whitespace-nowrap rounded-full bg-secondary px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground">
                {c.currency}
                <b className="font-mono tabular-nums font-semibold text-foreground">{fmt(c.nativeAmount)}</b>
              </div>
            ))}
            {netCash.loansOut.map((l) => (
              <div key={`loan-${l.currency}`} className="flex flex-none items-baseline gap-1.5 whitespace-nowrap rounded-full bg-amber-soft px-3 py-1.5 text-[12.5px] font-semibold text-amber">
                Lent out
                <b className="font-mono tabular-nums font-semibold">{l.currency} {fmt(l.nativeAmount)}</b>
              </div>
            ))}
          </div>
        </div>

        {/* Estimated Monthly Savings (Dashboard v1.4) — Income minus Expense this month;
            shown regardless of whether a budget is configured, since it doesn't depend
            on one. */}
        <div
          className={cn(
            "mt-2.5 flex items-center justify-between rounded-[var(--radius-md)] border border-border bg-card px-3.5 py-3",
            hidden && "blur-sm select-none"
          )}
        >
          <span className="text-[12px] font-semibold text-muted-foreground">Estimated monthly savings</span>
          <span className={cn("font-mono text-[14px] font-bold tabular-nums", estimatedMonthlySavings < 0 && "text-destructive")}>
            {estimatedMonthlySavings < 0 ? "−" : ""}SGD {fmt(Math.abs(estimatedMonthlySavings), 0)}
          </span>
        </div>

        {budget && (
          <div className="mt-2.5 rounded-[var(--radius-md)] border border-border bg-card p-3.5">
            <div className="flex items-center gap-3">
              <RingChart pct={pct ?? 0} />
              <div>
                <p className={cn("font-mono text-[18px] font-semibold tabular-nums", hidden && "blur-sm select-none")}>{pct ?? "—"}%</p>
                <p className={cn("text-[11.5px] text-muted-foreground", hidden && "blur-sm select-none")}>
                  SGD {fmt(budget.spentSgd, 0)} / {fmt(budget.budgetedSgd, 0)} this month
                </p>
              </div>
            </div>

            {/* Budget Remaining (Dashboard v1.4) */}
            <div className={cn("mt-3 flex items-center justify-between border-t border-border pt-3 text-[12px]", hidden && "blur-sm select-none")}>
              <span className="text-muted-foreground">Budget remaining</span>
              <span className="font-mono font-semibold tabular-nums">SGD {fmt(Math.max(0, budget.budgetedSgd - budget.spentSgd), 0)}</span>
            </div>

            {/* Budget Pace (Dashboard v1.4) — transparent, mathematically verifiable:
                expected % assumes even spend across the month; actual % is the real,
                uncapped figure. No traffic-light status, just the two numbers and a
                plain comparison sentence. */}
            {budgetPace && (
              <div className={cn("mt-2 text-[11.5px] leading-relaxed", hidden && "blur-sm select-none")}>
                <p className="text-muted-foreground">
                  Day {budgetPace.dayOfMonth} of {budgetPace.daysInMonth} · Expected {budgetPace.expectedPct}% · Actual {budgetPace.actualPct}%
                </p>
                <p className="mt-0.5 font-medium text-foreground">
                  {budgetPace.comparison === "above"
                    ? "You're spending above your planned monthly pace."
                    : budgetPace.comparison === "below"
                      ? "You're spending below your planned monthly pace."
                      : "You're spending right on your planned monthly pace."}
                </p>
              </div>
            )}

            {budget.isCarriedForward && (
              <p className="mt-2 text-[11px] text-amber">
                Showing {budget.sourceMonth}&apos;s budget — {monthLabel} hasn&apos;t been started yet.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Attention (Dashboard v1.4) — conditional: hidden entirely when nothing needs
          attention, never an empty-state message. Every item deep-links to the exact
          place to investigate (Capture Inbox, Exchange Rate Settings, or Activity
          filtered to the contributing category), reusing navigation that already exists —
          Dashboard decides, Activity investigates. */}
      {attentionItems.length > 0 && (
        <section className="mb-6">
          <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Needs your attention</p>
          <div className="flex flex-col gap-2">
            {attentionItems.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="block rounded-[var(--radius-lg)] border border-amber/40 bg-amber-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-foreground"
              >
                {item.message}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Recent Transactions */}
      <section className="mb-6">
        <div className="mb-2.5 flex items-baseline justify-between">
          <p className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Recent transactions</p>
          <Link href="/activity" className="text-[12.5px] font-semibold text-primary">
            See all
          </Link>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
            No transactions yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {recentTransactions.map((t) => {
              const CategoryIcon = categoryIcon(t.primaryCategory);
              const { label: typeLabel, Icon: TypeIcon } = transactionTypeMeta(t.transactionType);
              const titleInput = {
                transactionType: t.transactionType,
                merchant: t.merchant,
                sourceAccountName: t.sourceAccountId ? (accountNameById[t.sourceAccountId] ?? null) : null,
                destinationAccountName: t.targetAccountId ? (accountNameById[t.targetAccountId] ?? null) : null,
              };
              const title = transactionTitle(titleInput);
              const sourceAccount = sourceAccountSubline(titleInput);
              return (
                <div
                  key={t.id}
                  className="relative overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card shadow-md"
                >
                  <button
                    type="button"
                    onClick={() => router.push(`/activity?highlight=${t.id}`)}
                    className="flex w-full items-center gap-3 px-3 py-[26px] pr-9 text-left transition-transform active:scale-[0.98] motion-reduce:transition-none"
                  >
                    <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[var(--radius-md)] bg-secondary text-muted-foreground">
                      <CategoryIcon size={18} strokeWidth={2} />
                    </div>

                    <div className="min-w-0 flex-1">
                      {/* Line 1 — merchant (strongest element) + amount, same row. */}
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[14.5px] font-bold leading-tight">{title}</p>
                        <div className={cn("flex-none text-right", hidden && "blur-sm select-none")}>
                          {t.currencyGroup === "INR" ? (
                            <>
                              <div className="font-mono text-[14.5px] font-bold tabular-nums">₹{fmt(t.originalAmount)}</div>
                              <div className="font-mono text-[9.5px] text-muted-foreground tabular-nums">≈SGD {fmt(t.sgdAmount)}</div>
                            </>
                          ) : t.currency === "SGD" ? (
                            <div className="font-mono text-[14.5px] font-bold tabular-nums">SGD {fmt(t.originalAmount)}</div>
                          ) : (
                            <>
                              <div className="font-mono text-[14.5px] font-bold tabular-nums">SGD {fmt(t.sgdAmount)}</div>
                              <div className="font-mono text-[9.5px] text-muted-foreground tabular-nums">{t.currency} {fmt(t.originalAmount)}</div>
                            </>
                          )}
                          {/* Source Account Visibility — same rule as Activity's
                              TransactionCard: hidden for an internal Transfer since the
                              title already reads "Source → Destination". */}
                          {sourceAccount && <div className="mt-0.5 truncate text-[9.5px] text-muted-foreground">{sourceAccount}</div>}
                        </div>
                      </div>

                      {/* Line 2 — Receipt/Payment/Transfer + receipt date (left), compact
                          category chip (right). transactionType is a real signal already on
                          the header row (no "Manual" capture-method field exists in the
                          schema without a new query, so Payment/Transfer/Receipt is the
                          honest distinction available — see CLAUDE.md). */}
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <p className="flex min-w-0 items-center gap-1 truncate text-[11px] text-muted-foreground">
                          <TypeIcon size={10} className="flex-none" />
                          <span className="truncate">
                            {typeLabel} • {formatReceiptDateFull(t.transactionDate)}
                          </span>
                        </p>
                        <span className="inline-flex flex-none items-center gap-1 rounded-full bg-secondary/70 px-1.5 py-[1px] text-[9.5px] font-semibold text-muted-foreground">
                          <CategoryIcon size={9} />
                          {subtitleCategory(t.transactionType, t.primaryCategory) || "Uncategorized"}
                        </span>
                      </div>

                      {/* Line 3 — captured date + time, year never hidden (§1/§2). */}
                      <p className="mt-0.5 text-[10px] text-muted-foreground/70">Captured {formatCapturedFull(t.capturedAt)}</p>
                    </div>
                  </button>

                  {/* Overflow menu (Dashboard Recent Transactions Edit Action) — same
                      portal-based ⋮ trigger as Activity's own transaction cards. */}
                  <button
                    type="button"
                    aria-label="Transaction actions"
                    title="Transaction actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMenu(t.id, e.currentTarget.getBoundingClientRect());
                    }}
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="5" r="1.8" />
                      <circle cx="12" cy="12" r="1.8" />
                      <circle cx="12" cy="19" r="1.8" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {actionError && <p className="mb-4 text-[12px] font-semibold text-destructive">{actionError}</p>}

      {/* Overflow menu — portal-rendered so it's never clipped by a card's own overflow-hidden.
          Same actions as Activity's own menu (Edit/View Receipt/Delete — Transaction UX
          Final Polish, Part 5), reusing the exact same handlers/requests; "View in Activity"
          is Dashboard's own additional shortcut, kept alongside them. */}
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
                closeMenu();
                handleViewReceipt(id);
              }}
              className="block w-full border-t border-border px-3.5 py-2.5 text-left text-[12.5px] font-semibold disabled:opacity-50"
            >
              {receiptLoadingId === menuAnchor.id ? "Loading…" : "View Receipt"}
            </button>
            <Link
              href={`/activity?highlight=${menuAnchor.id}`}
              onClick={closeMenu}
              className="block w-full border-t border-border px-3.5 py-2.5 text-left text-[12.5px] font-semibold"
            >
              View in Activity
            </Link>
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

      {/* View Receipt — reuses the stored original file(s), read-only (same as Activity). */}
      {viewingReceipt && <ReceiptViewer pages={viewingReceipt} onClose={() => setViewingReceipt(null)} />}

      {/* Delete confirmation — same pattern as Activity's own quick-delete. */}
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

      {/* Edit — the SAME Review screen used by Capture and Activity, populated from the
          saved transaction. Save UPDATEs it, never creates a new one (§3/§7). Delete
          (Transaction Workspace Foundation) removes the local card in place, same as Save. */}
      {editing && masterData && (
        <ReviewScreen
          result={editing.result}
          masterData={masterData}
          capturedAt={editing.capturedAt}
          headerId={editing.headerId}
          itemIds={editing.itemIds}
          onCancel={closeEditor}
          onSave={saveEditor}
          onDelete={deleteEditor}
        />
      )}
    </div>
  );
}

/** "25 Jul 2026" — Receipt Date, year always shown (never abbreviated away — a card
 *  showing "17 Jan" with no year reads as ambiguous once transactions span year
 *  boundaries, and Recent Transactions already surfaces receipts back-dated that far). */
function formatReceiptDateFull(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** "25 Jul 2026 • 10:11 PM" — Captured (ingestion) date + time, year always shown. */
function formatCapturedFull(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const timePart = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${datePart} • ${timePart}`;
}

/** Receipt/Payment/Transfer label + icon from transaction_type (TAD-003 §11.2). There is
 *  no "was this a manual text entry or a scanned receipt" field in the schema — adding
 *  one would need a new column/query, which this milestone's Performance requirement
 *  forbids — so the honest, already-available distinction is transaction_type itself. */
function transactionTypeMeta(type: string): { label: string; Icon: typeof ReceiptTypeIcon } {
  if (type === TRANSACTION_TYPES.TRANSFER) return { label: "Transfer", Icon: ArrowLeftRight };
  return { label: "Receipt", Icon: ReceiptTypeIcon };
}

function RingChart({ pct }: { pct: number }) {
  const r = 19;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pct / 100);
  const color = pct >= 100 ? "var(--destructive)" : pct >= 80 ? "var(--amber)" : "var(--primary)";

  return (
    <svg width="46" height="46" viewBox="0 0 46 46" className="flex-none">
      <circle cx="23" cy="23" r={r} fill="none" stroke="var(--secondary)" strokeWidth="5" />
      <circle
        cx="23"
        cy="23"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 23 23)"
      />
    </svg>
  );
}

function today(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" });
}
