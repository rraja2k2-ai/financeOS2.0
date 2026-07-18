"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase";
import { projectBudgetRepository } from "@/repositories";
import { resetMonthBudgetToPrevious } from "@/services/finance/budget.service";

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
    });
  }

  revalidatePath("/budget");
}
