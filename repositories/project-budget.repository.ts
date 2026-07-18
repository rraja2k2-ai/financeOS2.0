import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectBudget } from "@/domain/project-budget";

export async function getById(supabase: SupabaseClient, id: string): Promise<ProjectBudget | null> {
  const { data, error } = await supabase
    .from("project_budgets")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function list(supabase: SupabaseClient): Promise<ProjectBudget[]> {
  const { data, error } = await supabase.from("project_budgets").select("*");

  if (error) {
    throw error;
  }

  return data || [];
}

/** All budget lines for one project in one month. `month` must be first-of-month, e.g. "2026-07-01". */
export async function listByProjectMonth(
  supabase: SupabaseClient,
  projectId: string,
  month: string
): Promise<ProjectBudget[]> {
  const { data, error } = await supabase
    .from("project_budgets")
    .select("*")
    .eq("project_id", projectId)
    .eq("budget_month", month)
    .order("primary_category", { ascending: true })
    .order("secondary_category", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

/** All budget lines across every project for one month (for the Budget screen's "By category" roll-up). */
export async function listByMonth(supabase: SupabaseClient, month: string): Promise<ProjectBudget[]> {
  const { data, error } = await supabase.from("project_budgets").select("*").eq("budget_month", month);

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * The most recent month (before `beforeMonth`) that has budget rows for this project.
 * Used by carry-forward. Returns null if this project has no earlier budget history.
 */
export async function latestMonthBefore(
  supabase: SupabaseClient,
  projectId: string,
  beforeMonth: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("project_budgets")
    .select("budget_month")
    .eq("project_id", projectId)
    .lt("budget_month", beforeMonth)
    .order("budget_month", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.budget_month ?? null;
}

export async function insert(supabase: SupabaseClient, projectBudget: Omit<ProjectBudget, "id" | "created_at" | "updated_at">): Promise<ProjectBudget> {
  const { data, error } = await supabase
    .from("project_budgets")
    .insert(projectBudget)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function update(supabase: SupabaseClient, id: string, projectBudget: Partial<Omit<ProjectBudget, "id" | "created_at" | "updated_at">>): Promise<ProjectBudget> {
  const { data, error } = await supabase
    .from("project_budgets")
    .update(projectBudget)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function remove(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("project_budgets").delete().eq("id", id);

  if (error) {
    throw error;
  }
}
