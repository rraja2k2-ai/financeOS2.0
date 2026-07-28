import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account } from "@/domain/account";

export async function getById(supabase: SupabaseClient, id: string): Promise<Account | null> {
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function list(supabase: SupabaseClient): Promise<Account[]> {
  const { data, error } = await supabase.from("accounts").select("*");

  if (error) {
    throw error;
  }

  return data || [];
}

export async function insert(supabase: SupabaseClient, account: Omit<Account, "id" | "created_at" | "updated_at">): Promise<Account> {
  const { data, error } = await supabase
    .from("accounts")
    .insert(account)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function update(supabase: SupabaseClient, id: string, account: Partial<Omit<Account, "id" | "created_at" | "updated_at">>): Promise<Account> {
  const { data, error } = await supabase
    .from("accounts")
    .update(account)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function remove(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("accounts").delete().eq("id", id);

  if (error) {
    throw error;
  }
}

/**
 * Atomically increments/decrements one or more accounts' current_balance in a single
 * Postgres statement (migration 019's apply_account_balance_deltas RPC) — the Account
 * Posting Engine's one write primitive. A Transfer's two legs (or an Edit's netted
 * reversal+reapply) either both land or neither does. No-op for an empty array.
 */
export async function applyBalanceDeltas(supabase: SupabaseClient, deltas: { accountId: string; delta: number }[]): Promise<void> {
  if (deltas.length === 0) return;

  const { error } = await supabase.rpc("apply_account_balance_deltas", {
    deltas: deltas.map((d) => ({ accountId: d.accountId, delta: d.delta })),
  });

  if (error) {
    throw error;
  }
}

/** Case-insensitive exact-name match — duplicate-name prevention (account-management.service.ts).
 *  Pass excludeId when editing an account so it doesn't collide with its own name. */
export async function existsByName(supabase: SupabaseClient, name: string, excludeId?: string): Promise<boolean> {
  let query = supabase.from("accounts").select("id", { count: "exact", head: true }).ilike("account_name", name);
  if (excludeId) query = query.neq("id", excludeId);

  const { count, error } = await query;
  if (error) {
    throw error;
  }

  return (count ?? 0) > 0;
}
