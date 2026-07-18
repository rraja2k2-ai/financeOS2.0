"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { shiftMonth, monthLabel } from "@/lib/period";
import { resetMonthToPreviousAction, updateBudgetAmountAction } from "@/app/budget/actions";
import type { CategoryBudgetVsActual } from "@/services/finance/budget.service";

export type BudgetViewProps = {
  month: string;
  projectId: string | null;
  totalBudgetedSgd: number;
  totalActualSgd: number;
  sourceMonth: string | null;
  categories: CategoryBudgetVsActual[];
};

function fmt(n: number, decimals = 0) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function pct(actual: number, budgeted: number): number | null {
  if (budgeted <= 0) return null;
  return Math.round((actual / budgeted) * 100);
}

function barColor(p: number | null): string {
  if (p === null) return "bg-muted-foreground";
  if (p >= 100) return "bg-destructive";
  if (p >= 80) return "bg-amber";
  return "bg-primary";
}

export function BudgetView({
  month,
  projectId,
  totalBudgetedSgd,
  totalActualSgd,
  sourceMonth,
  categories,
}: BudgetViewProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [isResetting, startReset] = useTransition();

  const overallPct = pct(totalActualSgd, totalBudgetedSgd);
  const remainingSgd = totalBudgetedSgd - totalActualSgd;

  function handleReset() {
    if (!projectId) return;
    setConfirmingReset(false);
    startReset(async () => {
      await resetMonthToPreviousAction(projectId, month);
    });
  }

  return (
    <div className="px-5 pt-6 pb-8">
      <h1 className="mb-4 text-[22px] font-bold tracking-tight">Budget</h1>

      {/* Monthly Budget selector */}
      <div className="mb-4 flex items-center justify-between rounded-[var(--radius-md)] border border-border bg-card p-2">
        <Link
          href={`/budget?month=${shiftMonth(month, -1)}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground"
          aria-label="Previous month"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <span className="text-[13.5px] font-bold">{monthLabel(month)}</span>
        <Link
          href={`/budget?month=${shiftMonth(month, 1)}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground"
          aria-label="Next month"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>
      </div>

      {/* Budget Overview */}
      <section className="mb-6">
        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Overview</p>
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-[18px]">
          <div className="flex items-center gap-4">
            <RingChart pct={overallPct ?? 0} />
            <div className="flex-1">
              <p className="font-mono text-[26px] font-semibold tabular-nums">{overallPct ?? "—"}%</p>
              <p className="text-[12px] text-muted-foreground">of budget used</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Budgeted</p>
              <p className="font-mono text-[15px] font-bold tabular-nums">SGD {fmt(totalBudgetedSgd)}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Actual</p>
              <p className="font-mono text-[15px] font-bold tabular-nums">SGD {fmt(totalActualSgd)}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {remainingSgd >= 0 ? "Remaining" : "Overspent"}
              </p>
              <p className={cn("font-mono text-[15px] font-bold tabular-nums", remainingSgd < 0 && "text-destructive")}>
                SGD {fmt(Math.abs(remainingSgd))}
              </p>
            </div>
          </div>

          {sourceMonth && (
            <p className="mt-3 text-[11px] text-amber">
              Copied from {sourceMonth}&apos;s budget — {monthLabel(month)} had no budget set yet.
            </p>
          )}
          {!totalBudgetedSgd && !sourceMonth && (
            <p className="mt-3 text-[11px] text-muted-foreground">No budget set for {monthLabel(month)} yet.</p>
          )}
        </div>

        {projectId && (
          <div className="mt-2.5 flex items-center justify-end gap-2">
            {confirmingReset ? (
              <>
                <span className="text-[11px] text-muted-foreground">Delete this month&apos;s budget and re-copy?</span>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={isResetting}
                  className="rounded-lg bg-destructive px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                >
                  {isResetting ? "Resetting…" : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingReset(false)}
                  className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingReset(true)}
                className="text-[11px] font-semibold text-muted-foreground underline decoration-dotted"
              >
                Reset to previous month
              </button>
            )}
          </div>
        )}
      </section>

      {/* Primary Category budget cards */}
      <section className="mb-6">
        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">By category</p>

        {categories.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
            No budget or spend to show for {monthLabel(month)}.
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
            {categories.map((cat, i) => {
              const isOpen = expandedCategory === cat.primaryCategory;
              const p = pct(cat.actualSgd, cat.budgetedSgd);
              const over = cat.budgetedSgd > 0 && cat.actualSgd > cat.budgetedSgd;
              return (
                <div key={cat.primaryCategory} className={cn("p-3.5", i > 0 && "border-t border-border")}>
                  <button
                    className="flex w-full items-baseline justify-between text-left"
                    onClick={() => setExpandedCategory(isOpen ? null : cat.primaryCategory)}
                    aria-expanded={isOpen}
                  >
                    <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
                      {cat.primaryCategory}
                      {over && (
                        <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-destructive">
                          Overspent
                        </span>
                      )}
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={cn("text-muted-foreground transition-transform duration-300", isOpen && "rotate-180")}
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </span>
                    <span className="text-right font-mono text-[12.5px] font-semibold tabular-nums text-muted-foreground">
                      {fmt(cat.actualSgd)} / {cat.budgetedSgd > 0 ? fmt(cat.budgetedSgd) : "—"}
                    </span>
                  </button>

                  <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn("h-full rounded-full", barColor(p))}
                      style={{ width: p === null ? "0%" : `${Math.min(100, Math.max(4, p))}%` }}
                    />
                  </div>
                  {cat.budgetedSgd > 0 && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {cat.actualSgd <= cat.budgetedSgd
                        ? `SGD ${fmt(cat.budgetedSgd - cat.actualSgd)} remaining`
                        : `SGD ${fmt(cat.actualSgd - cat.budgetedSgd)} over budget`}
                    </p>
                  )}

                  <div className="grid transition-[grid-template-rows] duration-300 ease-in-out" style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}>
                    <div className="overflow-hidden">
                      <div className="mt-2.5 space-y-1.5">
                        {cat.subcategories.map((sub) => (
                          <SubcategoryRow
                            key={sub.name}
                            projectId={projectId}
                            month={month}
                            primaryCategory={cat.primaryCategory}
                            sub={sub}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="rounded-[var(--radius-md)] border border-dashed border-border p-3.5 text-center text-[11.5px] leading-relaxed text-muted-foreground">
        Household monthly budget. Per-project budgets live in the Projects module. Tap a category amount to edit it.
      </p>
    </div>
  );
}

function SubcategoryRow({
  projectId,
  month,
  primaryCategory,
  sub,
}: {
  projectId: string | null;
  month: string;
  primaryCategory: string;
  sub: { id: string | null; name: string; budgetedSgd: number; actualSgd: number };
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sub.budgetedSgd > 0 ? String(sub.budgetedSgd) : "");
  const [isSaving, startSaving] = useTransition();

  function handleSave() {
    if (!projectId) return;
    const amount = Number(draft);
    if (!draft || Number.isNaN(amount) || amount < 0) return;
    startSaving(async () => {
      await updateBudgetAmountAction({
        budgetLineId: sub.id,
        projectId,
        month,
        primaryCategory,
        secondaryCategory: sub.name === "General" ? null : sub.name,
        amountSgd: amount,
      });
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 border-l-2 border-primary py-1 pl-3.5 text-[12px]">
        <span className="flex-1 text-muted-foreground">{sub.name}</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-20 rounded-md border border-border bg-background px-1.5 py-0.5 text-right font-mono text-[12px] tabular-nums outline-none focus:border-primary"
        />
        <button type="button" onClick={handleSave} disabled={isSaving} className="text-[11px] font-semibold text-primary disabled:opacity-50">
          {isSaving ? "…" : "Save"}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-[11px] font-semibold text-muted-foreground">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => projectId && setEditing(true)}
      disabled={!projectId}
      className="flex w-full justify-between border-l-2 border-border py-1 pl-3.5 text-left text-[12px] text-muted-foreground disabled:cursor-default"
    >
      <span>{sub.name}</span>
      <span className="font-mono font-semibold tabular-nums text-foreground">
        {fmt(sub.actualSgd)} / {sub.budgetedSgd > 0 ? fmt(sub.budgetedSgd) : "—"}
      </span>
    </button>
  );
}

function RingChart({ pct }: { pct: number }) {
  const r = 27;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(100, pct) / 100);
  const color = pct >= 100 ? "var(--destructive)" : pct >= 80 ? "var(--amber)" : "var(--primary)";

  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="flex-none">
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--secondary)" strokeWidth="7" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 32 32)"
      />
    </svg>
  );
}
