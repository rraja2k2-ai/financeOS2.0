import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountMappingRule } from "@/domain/account-mapping-rule";

/**
 * Fix 4.1: Account Mapping Rules are an optional enhancement, never a mandatory
 * dependency — if migration 014 hasn't been run yet (or was rolled back), Capture
 * must keep working with no account hints rather than fail entirely. Only the
 * "table doesn't exist" case (PostgREST PGRST205) degrades to an empty list; any
 * other error (network, auth, etc.) still throws so real problems aren't hidden.
 */
export async function list(supabase: SupabaseClient): Promise<AccountMappingRule[]> {
  const { data, error } = await supabase.from("account_mapping_rules").select("*");

  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }

  return data || [];
}

function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "PGRST205";
}

export async function insert(
  supabase: SupabaseClient,
  rule: Omit<AccountMappingRule, "id" | "created_at">
): Promise<AccountMappingRule> {
  const { data, error } = await supabase.from("account_mapping_rules").insert(rule).select().single();

  if (error) {
    throw error;
  }

  return data;
}

export async function update(
  supabase: SupabaseClient,
  id: string,
  rule: Partial<Omit<AccountMappingRule, "id" | "created_at">>
): Promise<AccountMappingRule> {
  const { data, error } = await supabase.from("account_mapping_rules").update(rule).eq("id", id).select().single();

  if (error) {
    throw error;
  }

  return data;
}

export async function remove(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("account_mapping_rules").delete().eq("id", id);

  if (error) {
    throw error;
  }
}
