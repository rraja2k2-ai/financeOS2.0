/**
 * Project module service — live analytics for the Project workspace.
 *
 * Budget model (per product decision):
 *   - Per-category PROJECT budgets live in project_budgets under a sentinel budget_month
 *     (PROJECT_BUDGET_MONTH) — projects are lifetime, not monthly, so one fixed month
 *     keeps them cleanly separate from Generic's real monthly household budget.
 *   - A project's total budget = the sum of its category budget lines (SGD).
 *   - budget_type 'fixed' shows Budget vs Spent vs Remaining; 'track_only' shows spend only.
 *
 * Spend is measured at the TRANSACTION level (header.primary_category +
 * header.sgd_total_amount), not item level — the Project drill-down stops at Category
 * (no subcategories), so a whole transaction counts under its header's primary category.
 * Money-movement transactions (transfers, card payments) are excluded via isExpenseTransaction.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as projectBudgetRepository from "@/repositories/project-budget.repository";
import * as transactionHeaderRepository from "@/repositories/transaction-header.repository";
import type { Project } from "@/domain/project";
import type { TransactionHeader } from "@/domain/transaction-header";
import { isExpenseTransaction } from "@/lib/expense-filter";

/** Sentinel budget_month for lifetime project budgets — never collides with real months. */
export const PROJECT_BUDGET_MONTH = "1900-01-01";

export type ProjectAnalytics = {
  totalBudgetSgd: number;
  totalSpentSgd: number;
  remainingSgd: number;
  utilizationPct: number | null;
  transactionCount: number;
  categoriesUsed: number;
};

export type ProjectCategorySummary = {
  primaryCategory: string;
  budgetSgd: number;
  spentSgd: number;
  remainingSgd: number;
  /** project_budgets row id for this category's budget line, or null if none set yet. */
  budgetLineId: string | null;
};

export type ProjectCategoryTransaction = {
  id: string;
  transactionDate: string;
  merchant: string | null;
  currency: string;
  originalAmount: number;
  sgdAmount: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function analyticsFrom(headers: TransactionHeader[], budgetLines: { primary_category: string; budget_amount_sgd: string }[]): ProjectAnalytics {
  const expenseHeaders = headers.filter(isExpenseTransaction);
  const totalSpentSgd = round2(expenseHeaders.reduce((sum, h) => sum + Number(h.sgd_total_amount), 0));
  const totalBudgetSgd = round2(budgetLines.reduce((sum, b) => sum + Number(b.budget_amount_sgd), 0));
  const categoriesUsed = new Set(expenseHeaders.map((h) => h.primary_category)).size;

  return {
    totalBudgetSgd,
    totalSpentSgd,
    remainingSgd: round2(totalBudgetSgd - totalSpentSgd),
    utilizationPct: totalBudgetSgd > 0 ? Math.round((totalSpentSgd / totalBudgetSgd) * 100) : null,
    transactionCount: headers.length,
    categoriesUsed,
  };
}

/** Full analytics for one project. */
export async function getProjectAnalytics(supabase: SupabaseClient, projectId: string): Promise<ProjectAnalytics> {
  const [headers, budgetLines] = await Promise.all([
    transactionHeaderRepository.listByProjectId(supabase, projectId),
    projectBudgetRepository.listByProjectMonth(supabase, projectId, PROJECT_BUDGET_MONTH),
  ]);
  return analyticsFrom(headers, budgetLines);
}

/** Per-primary-category Budget/Spent/Remaining, sorted by highest spend. */
export async function getProjectCategorySummary(supabase: SupabaseClient, projectId: string): Promise<ProjectCategorySummary[]> {
  const [headers, budgetLines] = await Promise.all([
    transactionHeaderRepository.listByProjectId(supabase, projectId),
    projectBudgetRepository.listByProjectMonth(supabase, projectId, PROJECT_BUDGET_MONTH),
  ]);

  const spentByCategory = new Map<string, number>();
  for (const h of headers.filter(isExpenseTransaction)) {
    spentByCategory.set(h.primary_category, (spentByCategory.get(h.primary_category) ?? 0) + Number(h.sgd_total_amount));
  }

  const budgetByCategory = new Map(budgetLines.map((b) => [b.primary_category, b]));
  const categories = new Set<string>([...spentByCategory.keys(), ...budgetByCategory.keys()]);

  const summary: ProjectCategorySummary[] = Array.from(categories).map((primaryCategory) => {
    const budgetLine = budgetByCategory.get(primaryCategory);
    const budgetSgd = round2(budgetLine ? Number(budgetLine.budget_amount_sgd) : 0);
    const spentSgd = round2(spentByCategory.get(primaryCategory) ?? 0);
    return {
      primaryCategory,
      budgetSgd,
      spentSgd,
      remainingSgd: round2(budgetSgd - spentSgd),
      budgetLineId: budgetLine?.id ?? null,
    };
  });

  return summary.sort((a, b) => b.spentSgd - a.spentSgd);
}

/** All transactions for one project + one primary category (drill-down list). */
export async function getProjectCategoryTransactions(
  supabase: SupabaseClient,
  projectId: string,
  primaryCategory: string
): Promise<ProjectCategoryTransaction[]> {
  const headers = await transactionHeaderRepository.listByProjectId(supabase, projectId);
  return headers
    .filter((h) => h.primary_category === primaryCategory)
    .map((h) => ({
      id: h.id,
      transactionDate: h.transaction_date,
      merchant: h.merchant,
      currency: h.currency,
      originalAmount: Number(h.original_amount),
      sgdAmount: Number(h.sgd_total_amount),
    }));
}

export type ProjectDetail = {
  analytics: ProjectAnalytics;
  categories: ProjectCategorySummary[];
  /** Drill-down: all transactions for the project keyed by primary category. */
  transactionsByCategory: Record<string, ProjectCategoryTransaction[]>;
};

/** Everything the project dashboard needs, in a single pass over the project's data. */
export async function getProjectDetail(supabase: SupabaseClient, projectId: string): Promise<ProjectDetail> {
  const [headers, budgetLines] = await Promise.all([
    transactionHeaderRepository.listByProjectId(supabase, projectId),
    projectBudgetRepository.listByProjectMonth(supabase, projectId, PROJECT_BUDGET_MONTH),
  ]);

  const analytics = analyticsFrom(headers, budgetLines);

  const spentByCategory = new Map<string, number>();
  for (const h of headers.filter(isExpenseTransaction)) {
    spentByCategory.set(h.primary_category, (spentByCategory.get(h.primary_category) ?? 0) + Number(h.sgd_total_amount));
  }

  const budgetByCategory = new Map(budgetLines.map((b) => [b.primary_category, b]));
  const categoryNames = new Set<string>([...spentByCategory.keys(), ...budgetByCategory.keys()]);

  const categories: ProjectCategorySummary[] = Array.from(categoryNames)
    .map((primaryCategory) => {
      const budgetLine = budgetByCategory.get(primaryCategory);
      const budgetSgd = round2(budgetLine ? Number(budgetLine.budget_amount_sgd) : 0);
      const spentSgd = round2(spentByCategory.get(primaryCategory) ?? 0);
      return {
        primaryCategory,
        budgetSgd,
        spentSgd,
        remainingSgd: round2(budgetSgd - spentSgd),
        budgetLineId: budgetLine?.id ?? null,
      };
    })
    .sort((a, b) => b.spentSgd - a.spentSgd);

  const transactionsByCategory: Record<string, ProjectCategoryTransaction[]> = {};
  for (const h of headers) {
    const list = (transactionsByCategory[h.primary_category] ??= []);
    list.push({
      id: h.id,
      transactionDate: h.transaction_date,
      merchant: h.merchant,
      currency: h.currency,
      originalAmount: Number(h.original_amount),
      sgdAmount: Number(h.sgd_total_amount),
    });
  }

  return { analytics, categories, transactionsByCategory };
}

export type ProjectSummary = {
  project: Project;
  analytics: ProjectAnalytics;
};

/**
 * Lightweight summary for every project, for the Project list page. One pass over all
 * headers + all sentinel budget lines, grouped in memory (both are small tables) — avoids
 * an N+1 of per-project queries.
 */
export async function getProjectSummaries(supabase: SupabaseClient, projects: Project[]): Promise<ProjectSummary[]> {
  const [allHeaders, allBudgetLines] = await Promise.all([
    transactionHeaderRepository.list(supabase),
    projectBudgetRepository.listByMonth(supabase, PROJECT_BUDGET_MONTH),
  ]);

  const headersByProject = new Map<string, TransactionHeader[]>();
  for (const h of allHeaders) {
    if (!h.project_id) continue;
    if (!headersByProject.has(h.project_id)) headersByProject.set(h.project_id, []);
    headersByProject.get(h.project_id)!.push(h);
  }

  const budgetsByProject = new Map<string, { primary_category: string; budget_amount_sgd: string }[]>();
  for (const b of allBudgetLines) {
    if (!budgetsByProject.has(b.project_id)) budgetsByProject.set(b.project_id, []);
    budgetsByProject.get(b.project_id)!.push(b);
  }

  return projects.map((project) => ({
    project,
    analytics: analyticsFrom(headersByProject.get(project.id) ?? [], budgetsByProject.get(project.id) ?? []),
  }));
}
