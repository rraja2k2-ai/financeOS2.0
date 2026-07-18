import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransactionItem } from "@/domain/transaction-item";

export async function getById(supabase: SupabaseClient, id: string): Promise<TransactionItem | null> {
  const { data, error } = await supabase
    .from("transaction_items")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function list(supabase: SupabaseClient): Promise<TransactionItem[]> {
  const { data, error } = await supabase.from("transaction_items").select("*");

  if (error) {
    throw error;
  }

  return data || [];
}

export async function listByHeaderId(supabase: SupabaseClient, headerId: string): Promise<TransactionItem[]> {
  const { data, error } = await supabase
    .from("transaction_items")
    .select("*")
    .eq("header_id", headerId);

  if (error) {
    throw error;
  }

  return data || [];
}

/** Bulk fetch, e.g. all items belonging to a set of headers in a date range. */
export async function listByHeaderIds(supabase: SupabaseClient, headerIds: string[]): Promise<TransactionItem[]> {
  if (headerIds.length === 0) return [];

  const { data, error } = await supabase.from("transaction_items").select("*").in("header_id", headerIds);

  if (error) {
    throw error;
  }

  return data || [];
}

export async function insert(supabase: SupabaseClient, item: Omit<TransactionItem, "id" | "created_at" | "updated_at">): Promise<TransactionItem> {
  const { data, error } = await supabase
    .from("transaction_items")
    .insert(item)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function update(supabase: SupabaseClient, id: string, item: Partial<Omit<TransactionItem, "id" | "created_at" | "updated_at">>): Promise<TransactionItem> {
  const { data, error } = await supabase
    .from("transaction_items")
    .update(item)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function remove(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("transaction_items").delete().eq("id", id);

  if (error) {
    throw error;
  }
}
