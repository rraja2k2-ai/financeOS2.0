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
import type { ProjectBudget, CategoryType } from "@/domain/project-budget";
import type { CategorySpend } from "./category-spend.service";

export class CategoryAlreadyExistsError extends Error {}
export class CategoryNotFoundError extends Error {}

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
  // Decision 5 — an archived category stops being copied into future months (earlier
  // months, including `fromMonth` itself, are never touched by archiving). Archived
  // status is checked against the Category Master row, not the source month's own
  // is_archived copy — the master is the sole authority once a category is archived
  // (real monthly rows never get retroactively updated when their category is archived
  // later, so their own is_archived field can't be trusted for this decision).
  const masterRows = await projectBudgetRepository.listCategoryMasterRows(supabase, projectId);
  const archivedKeys = new Set(masterRows.filter((m) => m.is_archived).map((m) => `${m.primary_category}::${m.secondary_category ?? ""}`));
  const toCopy = sourceLines.filter(
    (l) => !archivedKeys.has(`${l.primary_category}::${l.secondary_category ?? ""}`) && !existingKeys.has(`${l.primary_category}::${l.secondary_category ?? ""}`)
  );

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
      is_archived: false,
      row_type: "MONTHLY",
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------------------
// Category Master (Master Data & Account Management Refactor, Decisions 4/5/6 — row_type
// discriminator design, per architecture review) — the Generic project's
// row_type = 'CATEGORY_MASTER' rows in project_budgets are FinanceOS's one source of
// truth for "what categories exist," replacing constants/categories.ts's
// CATEGORY_TAXONOMY. row_type (not budget_month) is what structurally separates these
// from real monthly budget data — the master's own lifecycle (create/rename/archive)
// never interacts with Reset to Previous Month, cloning, or any other real-month
// operation. Budget is the only place these are created/renamed/archived; Capture/
// Review/the Categories Settings reference page all read the same listCategoryMaster()
// result, never a second copy of the taxonomy.
// ---------------------------------------------------------------------------------------

/** budget_month filler for CATEGORY_MASTER rows — satisfies the NOT NULL constraint
 *  only. row_type is the sole discriminator; nothing may ever compare budget_month
 *  against this value to infer identity. */
const CATEGORY_MASTER_FILLER_MONTH = "1900-01-01";

export type CategoryMasterEntry = {
  primary: string;
  secondary: string | null;
  categoryType: CategoryType;
  isArchived: boolean;
};

/** Every category for a project (Generic, in practice) — one entry per Category Master
 *  row, i.e. one per (primary, secondary) pair, permanently. Pass `includeArchived: true`
 *  for a management view; Capture/Review's master data always excludes archived
 *  categories (they're retired, not selectable). */
export async function listCategoryMaster(supabase: SupabaseClient, projectId: string, includeArchived = false): Promise<CategoryMasterEntry[]> {
  const rows = await projectBudgetRepository.listCategoryMasterRows(supabase, projectId);
  return rows
    .filter((r) => includeArchived || !r.is_archived)
    .map((r) => ({
      primary: r.primary_category,
      secondary: r.secondary_category,
      categoryType: r.category_type,
      isArchived: r.is_archived,
    }));
}

/**
 * Adds a new category (Decision 5) — creates the permanent Category Master row (or
 * revives it, if the pair already exists archived) AND a real budget_amount 0 row for
 * `month` (the currently-viewed Budget month) so it's immediately visible/actionable
 * there, exactly matching "it appears in current month, future months inherit it" (the
 * clone mechanism already handles the "future months inherit it" half unchanged). If the
 * pair already exists in the master and is active, throws — this isn't a rename.
 */
export async function createCategory(
  supabase: SupabaseClient,
  projectId: string,
  month: string,
  primary: string,
  secondary: string | null,
  categoryType: CategoryType
): Promise<void> {
  const existingMaster = await projectBudgetRepository.getCategoryMasterRow(supabase, projectId, primary, secondary);
  if (existingMaster) {
    if (!existingMaster.is_archived) {
      throw new CategoryAlreadyExistsError(`"${secondary ? `${primary} / ${secondary}` : primary}" already exists.`);
    }
    await projectBudgetRepository.update(supabase, existingMaster.id, { is_archived: false });
  } else {
    await projectBudgetRepository.insert(supabase, {
      project_id: projectId,
      budget_month: CATEGORY_MASTER_FILLER_MONTH,
      primary_category: primary,
      secondary_category: secondary,
      category_type: categoryType,
      currency: "SGD",
      budget_amount: "0",
      exchange_rate: "1",
      budget_amount_sgd: "0",
      is_archived: false,
      row_type: "CATEGORY_MASTER",
    });
  }

  const existingMonthRow = await projectBudgetRepository.getByProjectCategoryMonth(supabase, projectId, primary, secondary, month);
  if (!existingMonthRow) {
    await projectBudgetRepository.insert(supabase, {
      project_id: projectId,
      budget_month: month,
      primary_category: primary,
      secondary_category: secondary,
      category_type: categoryType,
      currency: "SGD",
      budget_amount: "0",
      exchange_rate: "1",
      budget_amount_sgd: "0",
      is_archived: false,
      row_type: "MONTHLY",
    });
  }
}

/** Renames a category — updates the permanent Category Master row (so Capture/Review/
 *  Budget's "add category" list shows the new name immediately) AND every REAL monthly
 *  row from `fromMonth` (typically the currently viewed month) onward, matching Decision
 *  5's "previous months remain unchanged." Does not touch transaction_headers/
 *  transaction_items: historical transactions keep whatever category name they were
 *  saved with, same accounting-integrity reasoning as never rewriting a past transaction. */
export async function renameCategory(
  supabase: SupabaseClient,
  projectId: string,
  fromMonth: string,
  oldPrimary: string,
  oldSecondary: string | null,
  newPrimary: string,
  newSecondary: string | null
): Promise<void> {
  const master = await projectBudgetRepository.getCategoryMasterRow(supabase, projectId, oldPrimary, oldSecondary);
  if (!master) {
    throw new CategoryNotFoundError(`"${oldSecondary ? `${oldPrimary} / ${oldSecondary}` : oldPrimary}" doesn't exist.`);
  }
  await projectBudgetRepository.update(supabase, master.id, { primary_category: newPrimary, secondary_category: newSecondary });
  await projectBudgetRepository.renameCategoryFromMonth(supabase, projectId, oldPrimary, oldSecondary, newPrimary, newSecondary, fromMonth);
}

/** Archives a category (Decision 5) — flags the permanent Category Master row so the
 *  category stops being offered in Capture/Review/Budget's "add category" list and stops
 *  being copied into future months (see cloneMonthBudget's archived-check against this
 *  same row). Every real monthly row — including the currently viewed month's, if it
 *  already has one — is left completely untouched, matching "existing months remain
 *  unchanged." */
export async function archiveCategory(
  supabase: SupabaseClient,
  projectId: string,
  primary: string,
  secondary: string | null
): Promise<void> {
  const master = await projectBudgetRepository.getCategoryMasterRow(supabase, projectId, primary, secondary);
  if (!master) {
    throw new CategoryNotFoundError(`"${secondary ? `${primary} / ${secondary}` : primary}" doesn't exist.`);
  }
  await projectBudgetRepository.update(supabase, master.id, { is_archived: true });
}

/** Restores a previously archived category (v1.8.0) — the explicit counterpart to
 *  archiveCategory, flagging the Category Master row active again so it's immediately
 *  offered again in Capture/Review/Budget's "add category" list and copied into future
 *  months. (createCategory already revived a re-typed archived pair implicitly; this
 *  gives that same effect its own first-class action instead of relying on that side
 *  effect.) No real monthly row is touched — matches archiveCategory's own scope. */
export async function restoreCategory(
  supabase: SupabaseClient,
  projectId: string,
  primary: string,
  secondary: string | null
): Promise<void> {
  const master = await projectBudgetRepository.getCategoryMasterRow(supabase, projectId, primary, secondary);
  if (!master) {
    throw new CategoryNotFoundError(`"${secondary ? `${primary} / ${secondary}` : primary}" doesn't exist.`);
  }
  await projectBudgetRepository.update(supabase, master.id, { is_archived: false });
}
