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
