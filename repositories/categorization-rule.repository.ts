import type { SupabaseClient } from "@supabase/supabase-js";
import type { CategorizationRule } from "@/domain/categorization-rule";

export async function getById(supabase: SupabaseClient, id: string): Promise<CategorizationRule | null> {
  const { data, error } = await supabase
    .from("categorization_rules")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function list(supabase: SupabaseClient): Promise<CategorizationRule[]> {
  const { data, error } = await supabase.from("categorization_rules").select("*");

  if (error) {
    throw error;
  }

  return data || [];
}

export async function insert(supabase: SupabaseClient, rule: Omit<CategorizationRule, "id" | "created_at">): Promise<CategorizationRule> {
  const { data, error } = await supabase
    .from("categorization_rules")
    .insert(rule)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function update(supabase: SupabaseClient, id: string, rule: Partial<Omit<CategorizationRule, "id" | "created_at">>): Promise<CategorizationRule> {
  const { data, error } = await supabase
    .from("categorization_rules")
    .update(rule)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function remove(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("categorization_rules").delete().eq("id", id);

  if (error) {
    throw error;
  }
}
