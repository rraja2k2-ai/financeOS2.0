import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecurringRule } from "@/domain/recurring-rule";

export async function getById(supabase: SupabaseClient, id: string): Promise<RecurringRule | null> {
  const { data, error } = await supabase.from("recurring_rules").select("*").eq("id", id).single();

  if (error) {
    throw error;
  }

  return data;
}

export async function list(supabase: SupabaseClient): Promise<RecurringRule[]> {
  const { data, error } = await supabase.from("recurring_rules").select("*").order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

/** Active rules due on or before `onOrBefore` — the one query the manual Generate action
 *  runs (services/finance/recurring-rule.service.ts). Oldest-due first so a long-overdue
 *  rule's occurrences generate in chronological order. */
export async function listDue(supabase: SupabaseClient, onOrBefore: string): Promise<RecurringRule[]> {
  const { data, error } = await supabase
    .from("recurring_rules")
    .select("*")
    .eq("is_active", true)
    .lte("next_due_date", onOrBefore)
    .order("next_due_date", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

/** Whether any ACTIVE rule references this account as source or target — the recurring-rule
 *  half of the account delete guard (account-management.service.ts's deleteAccount already
 *  blocks on transaction history; this closes the gap a rule can create without ever
 *  having a transaction_headers row, since rules carry no link back from history). An
 *  Inactive rule is not a real future obligation, so it doesn't block deletion.
 *  TODO(future release): recurring_rules.source_account_id/target_account_id have no
 *  ON DELETE clause (migration 026), so the FK itself blocks deletion regardless of
 *  is_active — an INACTIVE rule still referencing this account will still raise a raw
 *  Postgres FK error here, since this check only looks at active rules. Narrow edge case
 *  (deactivate a rule without deleting it, then delete the account) — not fixed now, see
 *  CLAUDE.md's Release Checklist / Known Follow-ups. */
export async function existsActiveForAccountId(supabase: SupabaseClient, accountId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("recurring_rules")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .or(`source_account_id.eq.${accountId},target_account_id.eq.${accountId}`);

  if (error) {
    throw error;
  }

  return (count ?? 0) > 0;
}

/** Whether any ACTIVE rule references this project — the recurring-rule half of the
 *  project delete guard (project-management.service.ts's deleteProject already blocks on
 *  transaction history and lifetime budgets; this closes the gap a rule can create
 *  without either of those existing yet). Same is_active-only scope, and the same known
 *  gap, as existsActiveForAccountId above. */
export async function existsActiveForProjectId(supabase: SupabaseClient, projectId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("recurring_rules")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .eq("project_id", projectId);

  if (error) {
    throw error;
  }

  return (count ?? 0) > 0;
}

export async function insert(supabase: SupabaseClient, rule: Omit<RecurringRule, "id" | "created_at" | "updated_at">): Promise<RecurringRule> {
  const { data, error } = await supabase.from("recurring_rules").insert(rule).select().single();

  if (error) {
    throw error;
  }

  return data;
}

export async function update(
  supabase: SupabaseClient,
  id: string,
  rule: Partial<Omit<RecurringRule, "id" | "created_at" | "updated_at">>
): Promise<RecurringRule> {
  const { data, error } = await supabase.from("recurring_rules").update(rule).eq("id", id).select().single();

  if (error) {
    throw error;
  }

  return data;
}

export async function remove(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("recurring_rules").delete().eq("id", id);

  if (error) {
    throw error;
  }
}
