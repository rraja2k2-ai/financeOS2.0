"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase";
import { projectRepository, projectBudgetRepository } from "@/repositories";
import { convertToBaseCurrency } from "@/services/finance/exchange.service";
import { PROJECT_BUDGET_MONTH } from "@/services/finance/project.service";
import { isGenericProject } from "@/domain/project";
import type { BudgetType, ProjectStatus } from "@/domain/project";

export type ProjectMasterInput = {
  projectName: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  budgetType: BudgetType;
  budgetCurrency: string;
};

export async function createProjectAction(input: ProjectMasterInput) {
  if (!input.projectName.trim()) throw new Error("Project name is required.");

  const supabase = await createServerSupabaseClient();
  const project = await projectRepository.insert(supabase, {
    project_name: input.projectName.trim(),
    description: input.description?.trim() || null,
    start_date: input.startDate || null,
    end_date: input.endDate || null,
    status: "Active", // New projects are Active by default.
    budget_type: input.budgetType,
    budget_currency: input.budgetCurrency,
    budget_amount: null,
    project_currency: null,
    project_budget: null,
    project_budget_sgd: null,
  });

  revalidatePath("/projects");
  return project.id;
}

export async function updateProjectAction(id: string, input: ProjectMasterInput) {
  const supabase = await createServerSupabaseClient();
  const existing = await projectRepository.getById(supabase, id);
  if (!existing) throw new Error("Project not found.");

  // Generic is a system project: cannot be renamed.
  const projectName = isGenericProject(existing) ? existing.project_name : input.projectName.trim();
  if (!projectName) throw new Error("Project name is required.");

  await projectRepository.update(supabase, id, {
    project_name: projectName,
    description: input.description?.trim() || null,
    start_date: input.startDate || null,
    end_date: input.endDate || null,
    budget_type: input.budgetType,
    budget_currency: input.budgetCurrency,
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
}

export async function setProjectStatusAction(id: string, status: ProjectStatus) {
  const supabase = await createServerSupabaseClient();
  const existing = await projectRepository.getById(supabase, id);
  if (!existing) throw new Error("Project not found.");

  // Generic cannot be marked Inactive.
  if (isGenericProject(existing) && status === "Inactive") {
    throw new Error("The Generic project cannot be made inactive.");
  }

  await projectRepository.update(supabase, id, { status });
  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
}

export async function deleteProjectAction(id: string) {
  const supabase = await createServerSupabaseClient();
  const existing = await projectRepository.getById(supabase, id);
  if (!existing) throw new Error("Project not found.");

  // Generic cannot be deleted.
  if (isGenericProject(existing)) {
    throw new Error("The Generic project cannot be deleted.");
  }

  await projectRepository.remove(supabase, id);
  revalidatePath("/projects");
}

/**
 * Upserts a single per-category project budget line (stored under the sentinel month).
 * Amount is entered in the project's budget currency and converted to SGD for roll-ups.
 * Passing amount 0 clears the budget line (deletes it).
 */
export async function saveProjectCategoryBudgetAction(input: {
  budgetLineId: string | null;
  projectId: string;
  primaryCategory: string;
  currency: string;
  amount: number;
}) {
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new Error("Budget amount must be a non-negative number.");
  }

  const supabase = await createServerSupabaseClient();

  if (input.amount === 0) {
    if (input.budgetLineId) {
      await projectBudgetRepository.remove(supabase, input.budgetLineId);
    }
    revalidatePath(`/projects/${input.projectId}`);
    return;
  }

  const { baseAmount, exchangeRate } = await convertToBaseCurrency(supabase, input.amount, input.currency);
  const fields = {
    budget_amount: input.amount.toFixed(2),
    exchange_rate: exchangeRate === null ? "1" : String(exchangeRate),
    budget_amount_sgd: baseAmount.toFixed(2),
    currency: input.currency,
  };

  if (input.budgetLineId) {
    await projectBudgetRepository.update(supabase, input.budgetLineId, fields);
  } else {
    await projectBudgetRepository.insert(supabase, {
      project_id: input.projectId,
      budget_month: PROJECT_BUDGET_MONTH,
      primary_category: input.primaryCategory,
      secondary_category: null,
      category_type: "expense",
      ...fields,
    });
  }

  revalidatePath(`/projects/${input.projectId}`);
}
