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
