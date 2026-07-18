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

/**
 * Look up the categorization rule for a merchant name. merchant_pattern is a short
 * fragment (e.g. "ntuc") that must appear inside the real merchant text (e.g.
 * "NTUC FairPrice") — the match direction is merchantText contains merchant_pattern,
 * not the reverse, so this cannot be expressed as a single ILIKE against merchantText.
 * merchant_pattern is also not guaranteed unique post-dedupe (see
 * docs/database/migrations/002_reconcile_categorization_rules.sql), so this always
 * returns the single highest-priority active match rather than assuming uniqueness.
 * The active rule set is small (tens of rows), so filtering client-side is fine.
 */
export async function getByMerchantPattern(
  supabase: SupabaseClient,
  merchantText: string
): Promise<CategorizationRule | null> {
  const { data, error } = await supabase
    .from("categorization_rules")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: false });

  if (error) {
    throw error;
  }

  const haystack = merchantText.trim().toLowerCase();
  const match = (data || []).find((rule) => haystack.includes(rule.merchant_pattern.trim().toLowerCase()));

  return match ?? null;
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
