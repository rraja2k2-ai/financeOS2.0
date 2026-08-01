"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase";
import { projectBudgetRepository } from "@/repositories";
import { resetMonthBudgetToPrevious, createCategory, renameCategory, archiveCategory, restoreCategory } from "@/services/finance/budget.service";
import type { CategoryType } from "@/domain/project-budget";

export async function resetMonthToPreviousAction(projectId: string, month: string) {
  const supabase = await createServerSupabaseClient();
  await resetMonthBudgetToPrevious(supabase, projectId, month);
  revalidatePath("/budget");
}

/**
 * Updates (or creates, if `budgetLineId` is null) a single category/subcategory budget
 * line's amount. Entered directly in SGD (currency='SGD', exchange_rate=1) — this simple
 * inline editor doesn't support entering a budget in a foreign currency.
 */
export async function updateBudgetAmountAction(input: {
  budgetLineId: string | null;
  projectId: string;
  month: string;
  primaryCategory: string;
  secondaryCategory: string | null;
  amountSgd: number;
}) {
  if (!Number.isFinite(input.amountSgd) || input.amountSgd < 0) {
    throw new Error("Budget amount must be a non-negative number.");
  }

  const supabase = await createServerSupabaseClient();
  const amount = input.amountSgd.toFixed(2);

  if (input.budgetLineId) {
    await projectBudgetRepository.update(supabase, input.budgetLineId, {
      budget_amount: amount,
      exchange_rate: "1",
      budget_amount_sgd: amount,
    });
  } else {
    await projectBudgetRepository.insert(supabase, {
      project_id: input.projectId,
      budget_month: input.month,
      primary_category: input.primaryCategory,
      secondary_category: input.secondaryCategory,
      category_type: "expense",
      currency: "SGD",
      budget_amount: amount,
      exchange_rate: "1",
      budget_amount_sgd: amount,
      is_archived: false,
      row_type: "MONTHLY",
    });
  }

  revalidatePath("/budget");
}

/** Decision 5 — adds a new category (or revives an archived one) to the Category Master
 *  (Generic project). See budget.service.ts's createCategory for the revive/duplicate rules. */
export async function createCategoryAction(input: {
  projectId: string;
  month: string;
  primaryCategory: string;
  secondaryCategory: string | null;
  categoryType: CategoryType;
}) {
  const primary = input.primaryCategory.trim();
  if (!primary) {
    throw new Error("Category name is required.");
  }
  const secondary = input.secondaryCategory?.trim() || null;

  const supabase = await createServerSupabaseClient();
  await createCategory(supabase, input.projectId, input.month, primary, secondary, input.categoryType);
  revalidatePath("/budget");
  revalidatePath("/settings/categories");
}

/** Decision 5 — renames a category from `month` onward; earlier months keep the old name. */
export async function renameCategoryAction(input: {
  projectId: string;
  month: string;
  oldPrimaryCategory: string;
  oldSecondaryCategory: string | null;
  newPrimaryCategory: string;
  newSecondaryCategory: string | null;
}) {
  const newPrimary = input.newPrimaryCategory.trim();
  if (!newPrimary) {
    throw new Error("Category name is required.");
  }
  const newSecondary = input.newSecondaryCategory?.trim() || null;

  const supabase = await createServerSupabaseClient();
  await renameCategory(
    supabase,
    input.projectId,
    input.month,
    input.oldPrimaryCategory,
    input.oldSecondaryCategory,
    newPrimary,
    newSecondary
  );
  revalidatePath("/budget");
  revalidatePath("/settings/categories");
}

/** Decision 5 — archives a category (flags the Category Master row only); every real
 *  monthly row, including the currently viewed month's, is left untouched. */
export async function archiveCategoryAction(input: { projectId: string; primaryCategory: string; secondaryCategory: string | null }) {
  const supabase = await createServerSupabaseClient();
  await archiveCategory(supabase, input.projectId, input.primaryCategory, input.secondaryCategory);
  revalidatePath("/budget");
  revalidatePath("/settings/categories");
}

/** v1.8.0 — restores a previously archived category (flags the Category Master row only). */
export async function restoreCategoryAction(input: { projectId: string; primaryCategory: string; secondaryCategory: string | null }) {
  const supabase = await createServerSupabaseClient();
  await restoreCategory(supabase, input.projectId, input.primaryCategory, input.secondaryCategory);
  revalidatePath("/budget");
  revalidatePath("/settings/categories");
}
