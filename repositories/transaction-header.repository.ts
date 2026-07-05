import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransactionHeader } from "@/domain/transaction-header";

export async function getById(supabase: SupabaseClient, id: string): Promise<TransactionHeader | null> {
  const { data, error } = await supabase
    .from("transaction_headers")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function list(supabase: SupabaseClient): Promise<TransactionHeader[]> {
  const { data, error } = await supabase.from("transaction_headers").select("*");

  if (error) {
    throw error;
  }

  return data || [];
}

export async function insert(supabase: SupabaseClient, header: Omit<TransactionHeader, "id" | "created_at" | "updated_at">): Promise<TransactionHeader> {
  const { data, error } = await supabase
    .from("transaction_headers")
    .insert(header)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function update(supabase: SupabaseClient, id: string, header: Partial<Omit<TransactionHeader, "id" | "created_at" | "updated_at">>): Promise<TransactionHeader> {
  const { data, error } = await supabase
    .from("transaction_headers")
    .update(header)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function remove(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("transaction_headers").delete().eq("id", id);

  if (error) {
    throw error;
  }
}
