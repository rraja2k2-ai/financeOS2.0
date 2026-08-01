"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { shiftMonth, monthLabel, monthBounds, startOfMonthIso } from "@/lib/period";
import {
  resetMonthToPreviousAction,
  updateBudgetAmountAction,
  createCategoryAction,
  renameCategoryAction,
  archiveCategoryAction,
} from "@/app/budget/actions";
import type { CategoryBudgetVsActual } from "@/services/finance/budget.service";
import type { CategoryType } from "@/domain/project-budget";

/**
 * UI Phase 4 (Premium Budget Experience) — presentation-only redesign. All figures
 * below (totalBudgetedSgd, totalActualSgd, per-category budgeted/actual, subcategory
 * amounts) are computed server-side by budget.service.ts and passed in unchanged; this
 * file only decides how to lay them out. pct()/barColorClass() reuse the exact same
 * thresholds the previous version used (>=100 over, >=80 amber, else primary) — only
 * the visual treatment changed, never the math.
 */

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

/** Same three zones as before (>=100 / >=80 / else) — only the fill color changed, to
 *  match §4's "soft red" over-budget treatment instead of a hard-saturation red. */
function barColorClass(p: number | null): string {
  if (p === null) return "bg-muted-foreground/30";
  if (p >= 100) return "bg-destructive/70";
  if (p >= 80) return "bg-amber";
  return "bg-primary";
}

/** Pure calendar arithmetic (no budget/business logic) — how many days remain in the
 *  month being viewed, only meaningful when that month is the real current month. */
function daysLeftInMonth(month: string): number | null {
  if (month !== startOfMonthIso()) return null;
  const { end } = monthBounds(month);
  const endOfMonth = new Date(end + "T00:00:00Z");
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  return Math.max(0, Math.round((endOfMonth.getTime() - today.getTime()) / 86_400_000));
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
  const daysLeft = daysLeftInMonth(month);

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

      {/* Budget Summary Hero — stat grid + one horizontal bar, no ring/chart (§1). */}
      <section className="mb-5">
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-[18px] shadow-md">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Current Month</p>
          <p className="mt-0.5 text-[17px] font-bold tracking-tight">{monthLabel(month)}</p>

          <div className="mt-4 grid grid-cols-2 gap-y-4">
            <HeroStat label="Total Budget" value={`SGD ${fmt(totalBudgetedSgd)}`} />
            <HeroStat label="Spent" value={`SGD ${fmt(totalActualSgd)}`} />
            <HeroStat
              label={remainingSgd >= 0 ? "Remaining" : "Overspent"}
              value={`SGD ${fmt(Math.abs(remainingSgd))}`}
              tone={remainingSgd < 0 ? "destructive" : undefined}
            />
            <HeroStat label="Progress" value={overallPct !== null ? `${overallPct}%` : "—"} />
          </div>

          <div className="mt-4 h-[6px] overflow-hidden rounded-full bg-secondary">
            <AnimatedBarFill pct={overallPct} />
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

      {/* Budget Pace (§2) — no invented pace calculation exists yet (see deliverable #4
          in the accompanying summary), so this only ever surfaces facts that already
          exist elsewhere in this response (remaining SGD) or pure calendar arithmetic
          (days left) — never a fabricated on-track/behind-pace verdict. */}
      {totalBudgetedSgd > 0 && (
        <section className="mb-5">
          <div className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-dashed border-border bg-card p-3.5">
            <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-secondary text-muted-foreground">
              <Clock size={15} strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-bold">Pace tracking</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                {daysLeft !== null
                  ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in ${monthLabel(month)}. Whether spending is ahead of or behind schedule isn't tracked yet.`
                  : `Pace tracking applies to the current month — you're viewing ${monthLabel(month)}.`}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Category cards (§3/§5) — one elevated card per category, hierarchy
          Category → Progress → Remaining → Budget, quick-scan in one glance. */}
      <section className="mb-6">
        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">By category</p>

        {categories.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
            No budget or spend to show for {monthLabel(month)}.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {categories.map((cat) => {
              const isOpen = expandedCategory === cat.primaryCategory;
              const p = pct(cat.actualSgd, cat.budgetedSgd);
              const over = cat.budgetedSgd > 0 && cat.actualSgd > cat.budgetedSgd;
              return (
                <div key={cat.primaryCategory} className="rounded-[var(--radius-lg)] border border-border bg-card p-3.5 shadow-md">
                  <button
                    className="flex w-full items-center justify-between text-left"
                    onClick={() => setExpandedCategory(isOpen ? null : cat.primaryCategory)}
                    aria-expanded={isOpen}
                  >
                    <span className="truncate text-[14px] font-bold">{cat.primaryCategory}</span>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={cn("flex-none text-muted-foreground transition-transform duration-300", isOpen && "rotate-180")}
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>

                  <div className="mt-2.5 h-[7px] overflow-hidden rounded-full bg-secondary">
                    <AnimatedBarFill pct={p} />
                  </div>

                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <RemainingBadge budgetedSgd={cat.budgetedSgd} actualSgd={cat.actualSgd} over={over} />
                    <span className="flex-none text-[11px] text-muted-foreground">
                      Budget <span className="font-mono font-semibold tabular-nums text-foreground">SGD {cat.budgetedSgd > 0 ? fmt(cat.budgetedSgd) : "—"}</span>
                    </span>
                  </div>
                  <p className="mt-1 text-right text-[10.5px] text-muted-foreground">
                    Spent <span className="font-mono tabular-nums">SGD {fmt(cat.actualSgd)}</span>
                  </p>

                  <div className="grid transition-[grid-template-rows] duration-300 ease-in-out" style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}>
                    <div className="overflow-hidden">
                      <div className="mt-2.5 space-y-1.5 border-t border-border/60 pt-2.5">
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

      {/* Category Master (Decisions 4/5/6) — the Generic project's rows here ARE the
          category master Capture/AI/Review read from; this is the one place to add,
          rename, or archive one. */}
      {projectId && <AddCategorySection projectId={projectId} month={month} />}

      <p className="mt-4 rounded-[var(--radius-md)] border border-dashed border-border p-3.5 text-center text-[11.5px] leading-relaxed text-muted-foreground">
        Household monthly budget. Per-project budgets live in the Projects module. Tap a category amount to edit it.
      </p>
    </div>
  );
}

function AddCategorySection({ projectId, month }: { projectId: string; month: string }) {
  const [open, setOpen] = useState(false);
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [categoryType, setCategoryType] = useState<CategoryType>("expense");
  const [error, setError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();

  function handleAdd() {
    setError(null);
    startPending(async () => {
      try {
        await createCategoryAction({
          projectId,
          month,
          primaryCategory: primary,
          secondaryCategory: secondary.trim() || null,
          categoryType,
        });
        setPrimary("");
        setSecondary("");
        setCategoryType("expense");
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add category.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 w-full rounded-[var(--radius-md)] border border-dashed border-border py-2.5 text-[12.5px] font-semibold text-primary"
      >
        + Add Category
      </button>
    );
  }

  return (
    <section className="mb-4 rounded-[var(--radius-lg)] border border-border bg-card p-3.5 shadow-md">
      <p className="mb-2.5 text-[13px] font-bold">Add Category</p>
      <div className="space-y-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          <input
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-primary"
            placeholder="Primary category"
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
          />
          <input
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-primary"
            placeholder="Secondary (optional)"
            value={secondary}
            onChange={(e) => setSecondary(e.target.value)}
          />
        </div>
        <select
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-primary"
          value={categoryType}
          onChange={(e) => setCategoryType(e.target.value as CategoryType)}
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        {categoryType === "income" && (
          <p className="text-[11px] text-muted-foreground">Income categories are selectable in Capture/Review but don&apos;t show a budget card here.</p>
        )}
        {error && <p className="text-[12px] font-semibold text-destructive">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending || !primary.trim()}
            onClick={handleAdd}
            className="flex-1 rounded-lg bg-primary py-2 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
            disabled={pending}
            className="flex-1 rounded-lg border border-border py-2 text-[13px] font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}

function HeroStat({ label, value, tone }: { label: string; value: string; tone?: "destructive" }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 font-mono text-[16px] font-bold tabular-nums", tone === "destructive" && "text-destructive")}>{value}</p>
    </div>
  );
}

/** Animates its fill in on mount instead of snapping to the final width immediately —
 *  purely a CSS transition, the target width (`pct`) is the same value passed in. */
function AnimatedBarFill({ pct }: { pct: number | null }) {
  const [width, setWidth] = useState(0);
  const target = pct === null ? 0 : Math.min(100, Math.max(pct > 0 ? 4 : 0, pct));

  // Plain effect, no requestAnimationFrame: the initial render paints at 0%, then this
  // runs after that paint and moves it to the target — the CSS transition below animates
  // the change. rAF isn't needed for that and isn't guaranteed to fire promptly in every
  // rendering context (e.g. a backgrounded/automated tab), so this is the more reliable form.
  useEffect(() => {
    setWidth(target);
  }, [target]);

  return <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", barColorClass(pct))} style={{ width: `${width}%` }} />;
}

function RemainingBadge({ budgetedSgd, actualSgd, over }: { budgetedSgd: number; actualSgd: number; over: boolean }) {
  if (budgetedSgd <= 0) {
    return <span className="rounded-full bg-secondary px-2.5 py-1 text-[10.5px] font-semibold text-muted-foreground">No budget set</span>;
  }
  const remaining = Math.abs(budgetedSgd - actualSgd);
  return (
    <span
      className={cn(
        "flex-none rounded-full px-2.5 py-1 text-[10.5px] font-bold tabular-nums",
        over ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary"
      )}
    >
      SGD {fmt(remaining)} {over ? "over" : "left"}
    </span>
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
  const [mode, setMode] = useState<"view" | "editAmount" | "rename" | "confirmArchive">("view");
  const [draft, setDraft] = useState(sub.budgetedSgd > 0 ? String(sub.budgetedSgd) : "");
  const [renamePrimary, setRenamePrimary] = useState(primaryCategory);
  const [renameSecondary, setRenameSecondary] = useState(sub.name === "General" ? "" : sub.name);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const secondaryCategory = sub.name === "General" ? null : sub.name;

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
        secondaryCategory,
        amountSgd: amount,
      });
      setMode("view");
    });
  }

  function handleRename() {
    if (!projectId) return;
    setError(null);
    startSaving(async () => {
      try {
        await renameCategoryAction({
          projectId,
          month,
          oldPrimaryCategory: primaryCategory,
          oldSecondaryCategory: secondaryCategory,
          newPrimaryCategory: renamePrimary,
          newSecondaryCategory: renameSecondary.trim() || null,
        });
        setMode("view");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not rename.");
      }
    });
  }

  function handleArchive() {
    if (!projectId) return;
    setError(null);
    startSaving(async () => {
      try {
        await archiveCategoryAction({ projectId, primaryCategory, secondaryCategory });
        setMode("view");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not archive.");
      }
    });
  }

  if (mode === "editAmount") {
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
        <button type="button" onClick={() => setMode("view")} className="text-[11px] font-semibold text-muted-foreground">
          Cancel
        </button>
      </div>
    );
  }

  if (mode === "rename") {
    return (
      <div className="space-y-1.5 border-l-2 border-primary py-1.5 pl-3.5 text-[12px]">
        <div className="flex items-center gap-1.5">
          <input
            className="w-24 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11.5px] outline-none focus:border-primary"
            value={renamePrimary}
            onChange={(e) => setRenamePrimary(e.target.value)}
            placeholder="Primary"
          />
          <input
            className="w-24 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11.5px] outline-none focus:border-primary"
            value={renameSecondary}
            onChange={(e) => setRenameSecondary(e.target.value)}
            placeholder="Secondary"
          />
        </div>
        {error && <p className="text-[10.5px] font-semibold text-destructive">{error}</p>}
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleRename} disabled={isSaving} className="text-[11px] font-semibold text-primary disabled:opacity-50">
            {isSaving ? "Saving…" : "Save rename"}
          </button>
          <button type="button" onClick={() => setMode("view")} className="text-[11px] font-semibold text-muted-foreground">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (mode === "confirmArchive") {
    return (
      <div className="space-y-1.5 border-l-2 border-destructive py-1.5 pl-3.5 text-[12px]">
        <p className="text-[11px] text-muted-foreground">
          Archive &quot;{sub.name}&quot;? It stops appearing in Capture/Review and future months — this month and earlier are unaffected.
        </p>
        {error && <p className="text-[10.5px] font-semibold text-destructive">{error}</p>}
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleArchive} disabled={isSaving} className="text-[11px] font-semibold text-destructive disabled:opacity-50">
            {isSaving ? "Archiving…" : "Confirm archive"}
          </button>
          <button type="button" onClick={() => setMode("view")} className="text-[11px] font-semibold text-muted-foreground">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex w-full items-center justify-between gap-1.5 border-l-2 border-border py-1 pl-3.5 text-[12px] text-muted-foreground">
      <button type="button" onClick={() => projectId && setMode("editAmount")} disabled={!projectId} className="min-w-0 flex-1 truncate text-left">
        {sub.name}
      </button>
      <span className="flex-none font-mono font-semibold tabular-nums text-foreground">
        {fmt(sub.actualSgd)} / {sub.budgetedSgd > 0 ? fmt(sub.budgetedSgd) : "—"}
      </span>
      {projectId && (
        <div className="flex flex-none items-center gap-1.5">
          <button type="button" onClick={() => setMode("rename")} className="text-[10.5px] font-semibold text-muted-foreground underline decoration-dotted">
            Rename
          </button>
          <button type="button" onClick={() => setMode("confirmArchive")} className="text-[10.5px] font-semibold text-muted-foreground underline decoration-dotted">
            Archive
          </button>
        </div>
      )}
    </div>
  );
}
