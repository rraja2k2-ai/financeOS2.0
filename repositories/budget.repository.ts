import type { SupabaseClient } from "@supabase/supabase-js";
import type { Budget } from "@/domain/budget";

export async function getById(supabase: SupabaseClient, id: string): Promise<Budget | null> {
  const { data, error } = await supabase
    .from("budgets")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function list(supabase: SupabaseClient): Promise<Budget[]> {
  const { data, error } = await supabase.from("budgets").select("*");

  if (error) {
    throw error;
  }

  return data || [];
}

export async function insert(supabase: SupabaseClient, budget: Omit<Budget, "id" | "created_at" | "updated_at">): Promise<Budget> {
  const { data, error } = await supabase
    .from("budgets")
    .insert(budget)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function update(supabase: SupabaseClient, id: string, budget: Partial<Omit<Budget, "id" | "created_at" | "updated_at">>): Promise<Budget> {
  const { data, error } = await supabase
    .from("budgets")
    .update(budget)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function remove(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("budgets").delete().eq("id", id);

  if (error) {
    throw error;
  }
}
