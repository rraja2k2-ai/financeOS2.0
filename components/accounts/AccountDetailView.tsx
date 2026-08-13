"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { currencyPrefix } from "@/lib/currency";
import type { Account } from "@/domain/account";
import type { PeriodKey } from "@/lib/period";
import type { AccountPeriodSummary } from "@/services/finance/account-detail.service";
import type { ActivityTransaction } from "@/services/finance/activity.service";
import type { InvestmentPortfolioMetrics } from "@/services/finance/investment-portfolio.service";
import type { ReceivableBreakdown } from "@/services/finance/receivable-breakdown.service";
import { PeriodSelector } from "@/components/shared/PeriodSelector";
import { TransactionCard } from "@/components/activity/TransactionCard";
import { ReviewScreen } from "@/components/capture/ReviewScreen";
import { CorrectBalanceForm } from "@/components/accounts/CorrectBalanceForm";
import { InvestmentKpiGrid } from "@/components/investments/InvestmentKpiGrid";
import { useTransactionEditor } from "@/hooks/useTransactionEditor";
import { useOverflowMenu } from "@/hooks/useOverflowMenu";
import { accountTypeLabel } from "@/constants/accounts";

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export type AccountDetailViewProps = {
  account: Account;
  summary: AccountPeriodSummary;
  recentTransactions: ActivityTransaction[];
  period: PeriodKey;
  customStart: string;
  customEnd: string;
  /** id -> account_name (Transaction UX Final Polish) — see activity-format.tsx's transactionTitle(). */
  accountNameById: Record<string, string>;
  /** id -> account_type — see activity-format.tsx's isGenuineInternalTransfer(), which
   *  keeps a Lending move into a Receivable account (one per currency) from being mislabeled an
   *  internal transfer here just like it is in Activity/Dashboard. */
  accountTypeById: Record<string, string>;
  /** Investment Portfolio Version 1 — null for any non-Investment account (section isn't
   *  rendered at all in that case); computed server-side from investment-portfolio.service.ts,
   *  never recalculated here. Lifetime figures, deliberately NOT connected to the period
   *  selector below (that section stays period-scoped, unchanged). */
  investmentMetrics: InvestmentPortfolioMetrics | null;
  /** Receivables person-wise analysis — null for any non-"LoanToOthers" account (section
   *  isn't rendered at all in that case); computed server-side from
   *  receivable-breakdown.service.ts, never recalculated here. Lifetime figures, same
   *  "deliberately not connected to the period selector" convention as investmentMetrics
   *  above — see that field's own comment. */
  receivableBreakdown: ReceivableBreakdown | null;
};

export function AccountDetailView({
  account,
  summary,
  recentTransactions,
  period,
  customStart,
  customEnd,
  accountNameById,
  accountTypeById,
  investmentMetrics,
  receivableBreakdown,
}: AccountDetailViewProps) {
  const router = useRouter();

  // Edit (Transaction Workspace Foundation) — Account Detail is a new entry point to the
  // one shared editor, wired the same way as Dashboard's Recent Transactions (lazy master
  // data, portal-based ⋮ menu). Save/Delete both just refresh this page's own data;
  // Account Detail has no local list to patch in place the way Dashboard does.
  const { anchor: menuAnchor, toggle: toggleMenu, close: closeMenu } = useOverflowMenu();
  const [actionError, setActionError] = useState<string | null>(null);
  const [adjustingBalance, setAdjustingBalance] = useState(false);
  const {
    masterData,
    editing,
    loadingId: editLoadingId,
    openEditor: handleEdit,
    closeEditor,
    saveEditor,
    deleteEditor,
  } = useTransactionEditor({
    onSaved: () => router.refresh(),
    onDeleted: () => router.refresh(),
    onError: setActionError,
  });

  function goToPeriod(next: { period: PeriodKey; from?: string; to?: string }) {
    const params = new URLSearchParams();
    params.set("period", next.period);
    if (next.period === "custom") {
      params.set("from", next.from ?? customStart);
      params.set("to", next.to ?? customEnd);
    }
    router.push(`/accounts/${account.id}?${params.toString()}`);
  }

  function activityHref(highlightId?: string): string {
    const params = new URLSearchParams();
    params.set("account", account.id);
    params.set("period", period);
    if (period === "custom") {
      params.set("from", customStart);
      params.set("to", customEnd);
    }
    if (highlightId) params.set("highlight", highlightId);
    return `/activity?${params.toString()}`;
  }

  return (
    <div className="px-5 pt-6 pb-8">
      <div className="mb-4 flex items-center gap-2">
        <Link href="/accounts" aria-label="Back to Accounts" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="flex-1 truncate text-[19px] font-bold tracking-tight">{account.account_name}</h1>
        <button
          type="button"
          onClick={() => setAdjustingBalance(true)}
          className="flex-none rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[11.5px] font-semibold text-primary"
        >
          Adjust Balance
        </button>
      </div>

      <section className="mb-6">
        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Account details</p>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-border bg-border sm:grid-cols-4">
          <div className="bg-card p-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Account Type</p>
            <p className="mt-0.5 text-[14px] font-bold">{accountTypeLabel(account.account_type)}</p>
          </div>
          <div className="bg-card p-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Currency</p>
            <p className="mt-0.5 text-[14px] font-bold">{account.currency}</p>
          </div>
          <div className="bg-card p-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Current Balance</p>
            <p className={cn("mt-0.5 font-mono text-[14px] font-bold tabular-nums", Number(account.current_balance) < 0 && "text-destructive")}>
              {currencyPrefix(account.currency)}
              {fmt(Number(account.current_balance))}
            </p>
          </div>
          <div className="bg-card p-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Opening Balance</p>
            <p className="mt-0.5 font-mono text-[14px] font-bold tabular-nums">
              {currencyPrefix(account.currency)}
              {fmt(Number(account.opening_balance))}
            </p>
          </div>
        </div>
      </section>

      {/* Investment Portfolio Version 1 — lifetime figures, intentionally not wired to the
          PeriodSelector below (that section stays period-scoped for Income/Expenses, a
          different, unrelated concept from Capital Invested/Portfolio Gain-Loss). Opening
          Balance above and Capital Invested here are different facts and are never
          reconciled — a real, expected discrepancy, not a bug. */}
      {investmentMetrics && (
        <section className="mb-6">
          <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Investment portfolio</p>
          <InvestmentKpiGrid metrics={investmentMetrics} variant="detail" />
        </section>
      )}

      {/* Receivables person-wise analysis — lifetime figures, same "not connected to the
          period selector" convention as Investment portfolio above (the two account types
          are mutually exclusive, so only one of these two sections ever renders). Dashboard
          intentionally stays aggregate-only (CLAUDE.md §4/§9) — this breakdown lives here,
          in Account Detail, and nowhere else. */}
      {receivableBreakdown && (
        <section className="mb-6">
          <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Outstanding by Person</p>
          {receivableBreakdown.byPerson.length === 0 && receivableBreakdown.unassigned === 0 ? (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
              No lending activity yet.
            </div>
          ) : (
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
              {receivableBreakdown.byPerson.map((p) => (
                <div key={p.person} className="flex items-center justify-between border-b border-border px-3.5 py-2.5 last:border-b-0">
                  <p className="truncate text-[13px] font-semibold">{p.person}</p>
                  <p className={cn("font-mono text-[13px] font-bold tabular-nums", p.amount < 0 && "text-destructive")}>
                    {p.amount < 0 ? "-" : ""}
                    {currencyPrefix(receivableBreakdown.currency)}
                    {fmt(Math.abs(p.amount))}
                  </p>
                </div>
              ))}
              {/* Only shown when nonzero — an honest label for whatever isn't attributable
                  to a named person (a balance correction on this account, a legacy/blank
                  merchant, or a nonzero opening balance), never a guessed person and never
                  a reason to change current_balance itself. */}
              {receivableBreakdown.unassigned !== 0 && (
                <div className="flex items-center justify-between border-b border-border bg-secondary/40 px-3.5 py-2.5 last:border-b-0">
                  <p className="truncate text-[13px] font-semibold text-muted-foreground">Unassigned</p>
                  <p className={cn("font-mono text-[13px] font-bold tabular-nums text-muted-foreground", receivableBreakdown.unassigned < 0 && "text-destructive")}>
                    {receivableBreakdown.unassigned < 0 ? "-" : ""}
                    {currencyPrefix(receivableBreakdown.currency)}
                    {fmt(Math.abs(receivableBreakdown.unassigned))}
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <PeriodSelector
        period={period}
        onPeriodChange={(p) => goToPeriod({ period: p })}
        customStart={customStart}
        customEnd={customEnd}
        onCustomStartChange={(d) => goToPeriod({ period: "custom", from: d, to: customEnd })}
        onCustomEndChange={(d) => goToPeriod({ period: "custom", from: customStart, to: d })}
      />

      <section className="mb-6">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <SummaryCard label="Income" value={`${currencyPrefix("SGD")}${fmt(summary.income)}`} />
          <SummaryCard label="Expenses" value={`${currencyPrefix("SGD")}${fmt(summary.expenses)}`} />
          <SummaryCard
            label="Net Change"
            value={`${summary.netChange < 0 ? "-" : ""}${currencyPrefix("SGD")}${fmt(Math.abs(summary.netChange))}`}
            negative={summary.netChange < 0}
          />
          <SummaryCard label="Transactions" value={String(summary.transactionCount)} />
        </div>
      </section>

      <section className="mb-6">
        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Recent Transactions</p>
        {recentTransactions.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
            No transactions for this account in the selected period.
          </div>
        ) : (
          <>
            {recentTransactions.map((t) => (
              <TransactionCard
                key={t.id}
                transaction={t}
                isOpen={false}
                onToggle={() => router.push(activityHref(t.id))}
                showActions
                onActionsClick={(rect) => toggleMenu(t.id, rect)}
                accountNameById={accountNameById}
                accountTypeById={accountTypeById}
                accountCurrency={account.currency}
              />
            ))}
            <Link href={activityHref()} className="mt-1 block text-center text-[12.5px] font-semibold text-primary">
              See All Transactions
            </Link>
          </>
        )}
      </section>

      {actionError && <p className="mb-4 text-[12px] font-semibold text-destructive">{actionError}</p>}

      {/* Overflow menu — same portal-based pattern as Activity/Dashboard's own cards, just
          a single Edit item (Delete lives inside the shared editor itself). */}
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
          </div>,
          document.body
        )}

      {/* Edit — the SAME Review screen used everywhere else, populated from the saved
          transaction. Save UPDATEs it, Delete removes it entirely; both just refresh this
          page (Transaction Workspace Foundation). */}
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

      {/* Adjust Balance (v1.8.0) — the same shared workflow as Settings → Accounts →
          Edit → Correct Balance (components/accounts/CorrectBalanceForm.tsx), reachable
          directly from the Accounts drill-down page. Refreshes this page's server data
          on success so Current Balance reflects the new Adjustment transaction. */}
      {adjustingBalance && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/50 px-6 py-10">
          <div className="w-full max-w-[380px] rounded-[var(--radius-lg)] border border-border bg-card p-5">
            <p className="text-[14.5px] font-bold">Adjust Balance</p>
            <p className="mt-1 text-[12px] text-muted-foreground">{account.account_name}</p>
            <CorrectBalanceForm
              account={account}
              onDone={() => {
                setAdjustingBalance(false);
                router.refresh();
              }}
              onCancel={() => setAdjustingBalance(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, negative = false }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-3">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 font-mono text-[14px] font-bold tabular-nums", negative && "text-destructive")}>{value}</p>
    </div>
  );
}
