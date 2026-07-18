/**
 * Budget Calculator (TAD-004 §3 Finance Services) — minimal read path.
 *
 * Carry-forward is READ-ONLY here: if the requested month has no budget rows yet for
 * a project, this returns the most recent prior month's rows (re-labeled as a
 * preview) rather than the empty set — but does NOT write/clone them into the
 * database. The actual "clone on first access" WRITE path (per the product decision:
 * auto-clone, user deletes unwanted lines) is a separate piece not built yet — this
 * only makes the read side honest and useful in the meantime.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as projectBudgetRepository from "@/repositories/project-budget.repository";
import * as transactionHeaderRepository from "@/repositories/transaction-header.repository";
import type { ProjectBudget } from "@/domain/project-budget";
import type { CategorySpend } from "./category-spend.service";

export type MonthBudget = {
  month: string;
  /** True if these rows are carried forward from an earlier month (not yet cloned for `month`). */
  isCarriedForward: boolean;
  /** The month these rows actually came from, if carried forward. */
  sourceMonth: string | null;
  lines: ProjectBudget[];
};

export async function getMonthBudget(
  supabase: SupabaseClient,
  projectId: string,
  month: string
): Promise<MonthBudget> {
  const direct = await projectBudgetRepository.listByProjectMonth(supabase, projectId, month);
  if (direct.length > 0) {
    return { month, isCarriedForward: false, sourceMonth: null, lines: direct };
  }

  const priorMonth = await projectBudgetRepository.latestMonthBefore(supabase, projectId, month);
  if (!priorMonth) {
    return { month, isCarriedForward: false, sourceMonth: null, lines: [] };
  }

  const priorLines = await projectBudgetRepository.listByProjectMonth(supabase, projectId, priorMonth);
  return { month, isCarriedForward: true, sourceMonth: priorMonth, lines: priorLines };
}

export function sumExpenseBudget(monthBudget: MonthBudget): number {
  return monthBudget.lines
    .filter((l) => l.category_type === "expense")
    .reduce((sum, l) => sum + Number(l.budget_amount_sgd), 0);
}

export type SubcategoryBudgetVsActual = {
  /** The underlying project_budgets row id, or null if no budget line exists for this subcategory yet. */
  id: string | null;
  name: string;
  budgetedSgd: number;
  actualSgd: number;
};

export type CategoryBudgetVsActual = {
  primaryCategory: string;
  budgetedSgd: number;
  actualSgd: number;
  subcategories: SubcategoryBudgetVsActual[];
};

/**
 * Clones every line from `fromMonth` into `toMonth` for one project — copies category,
 * subcategory, category_type, currency, budget amount (native + SGD) and the exchange
 * rate used at copy time. Does NOT copy actual spending or remaining budget (this table
 * never stored those — actuals are always computed live from transactions). Safe to call
 * repeatedly: skips any (primary, secondary) pair that already has a row in `toMonth`, so
 * it never creates duplicates.
 */
export async function cloneMonthBudget(
  supabase: SupabaseClient,
  projectId: string,
  fromMonth: string,
  toMonth: string
): Promise<ProjectBudget[]> {
  const [sourceLines, existingLines] = await Promise.all([
    projectBudgetRepository.listByProjectMonth(supabase, projectId, fromMonth),
    projectBudgetRepository.listByProjectMonth(supabase, projectId, toMonth),
  ]);

  const existingKeys = new Set(existingLines.map((l) => `${l.primary_category}::${l.secondary_category ?? ""}`));
  const toCopy = sourceLines.filter((l) => !existingKeys.has(`${l.primary_category}::${l.secondary_category ?? ""}`));

  const created: ProjectBudget[] = [];
  for (const line of toCopy) {
    const inserted = await projectBudgetRepository.insert(supabase, {
      project_id: projectId,
      budget_month: toMonth,
      primary_category: line.primary_category,
      secondary_category: line.secondary_category,
      category_type: line.category_type,
      currency: line.currency,
      budget_amount: line.budget_amount,
      exchange_rate: line.exchange_rate,
      budget_amount_sgd: line.budget_amount_sgd,
    });
    created.push(inserted);
  }

  return [...existingLines, ...created];
}

/**
 * Opens `month` for a project: if it already has budget rows, returns them directly. If
 * not, and an earlier month has rows, clones that earlier month's budget into `month` (a
 * real write, not a preview) and returns the newly created rows. If there's no earlier
 * budget history either, returns an empty month untouched.
 */
export async function ensureMonthBudget(supabase: SupabaseClient, projectId: string, month: string): Promise<MonthBudget> {
  const direct = await projectBudgetRepository.listByProjectMonth(supabase, projectId, month);
  if (direct.length > 0) {
    return { month, isCarriedForward: false, sourceMonth: null, lines: direct };
  }

  const priorMonth = await projectBudgetRepository.latestMonthBefore(supabase, projectId, month);
  if (!priorMonth) {
    return { month, isCarriedForward: false, sourceMonth: null, lines: [] };
  }

  const lines = await cloneMonthBudget(supabase, projectId, priorMonth, month);
  return { month, isCarriedForward: false, sourceMonth: priorMonth, lines };
}

/**
 * Reset to Previous Month: deletes every budget row for `month` on this project, then
 * clones the nearest earlier month again. Only affects the selected month/project.
 */
export async function resetMonthBudgetToPrevious(supabase: SupabaseClient, projectId: string, month: string): Promise<MonthBudget> {
  const currentLines = await projectBudgetRepository.listByProjectMonth(supabase, projectId, month);
  for (const line of currentLines) {
    await projectBudgetRepository.remove(supabase, line.id);
  }

  return ensureMonthBudget(supabase, projectId, month);
}

/**
 * Merges a month's expense budget lines with real category actuals (from
 * getCategorySpend) into per-primary-category cards. Includes categories that only
 * have a budget (nothing spent yet) and categories that only have actuals (spend in a
 * category nobody budgeted for, e.g. Miscellaneous) — neither side is assumed complete.
 */
export function combineBudgetVsActual(monthBudget: MonthBudget, categorySpend: CategorySpend[]): CategoryBudgetVsActual[] {
  const expenseLines = monthBudget.lines.filter((l) => l.category_type === "expense");

  const budgetByPrimary = new Map<string, Map<string, { amountSgd: number; id: string | null }>>();
  for (const line of expenseLines) {
    const secondary = line.secondary_category ?? "General";
    if (!budgetByPrimary.has(line.primary_category)) budgetByPrimary.set(line.primary_category, new Map());
    const subMap = budgetByPrimary.get(line.primary_category)!;
    const prev = subMap.get(secondary);
    subMap.set(secondary, { amountSgd: (prev?.amountSgd ?? 0) + Number(line.budget_amount_sgd), id: line.id });
  }

  const actualByPrimary = new Map(categorySpend.map((c) => [c.primaryCategory, c]));
  const allPrimaries = new Set([...budgetByPrimary.keys(), ...actualByPrimary.keys()]);

  const result: CategoryBudgetVsActual[] = Array.from(allPrimaries).map((primary) => {
    const subBudget = budgetByPrimary.get(primary) ?? new Map<string, { amountSgd: number; id: string | null }>();
    const actualCat = actualByPrimary.get(primary);
    const subNames = new Set([...subBudget.keys(), ...(actualCat?.subcategories.map((s) => s.name) ?? [])]);

    const subcategories: SubcategoryBudgetVsActual[] = Array.from(subNames)
      .map((name) => ({
        id: subBudget.get(name)?.id ?? null,
        name,
        budgetedSgd: round2(subBudget.get(name)?.amountSgd ?? 0),
        actualSgd: round2(actualCat?.subcategories.find((s) => s.name === name)?.sgdAmount ?? 0),
      }))
      .sort((a, b) => b.actualSgd - a.actualSgd);

    return {
      primaryCategory: primary,
      budgetedSgd: round2(Array.from(subBudget.values()).reduce((sum, v) => sum + v.amountSgd, 0)),
      actualSgd: round2(actualCat?.sgdAmount ?? 0),
      subcategories,
    };
  });

  return result.sort((a, b) => b.actualSgd - a.actualSgd);
}

/** Real total SGD spend attributed to one project in a date range (for Project Budget cards). */
export async function getProjectActualSgd(
  supabase: SupabaseClient,
  projectId: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const headers = await transactionHeaderRepository.listByDateRange(supabase, startDate, endDate);
  const projectHeaders = headers.filter((h) => h.project_id === projectId);
  return round2(projectHeaders.reduce((sum, h) => sum + Number(h.sgd_total_amount), 0));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
