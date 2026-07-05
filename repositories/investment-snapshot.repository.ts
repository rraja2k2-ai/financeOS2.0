import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvestmentSnapshot } from "@/domain/investment-snapshot";

export async function getById(supabase: SupabaseClient, id: string): Promise<InvestmentSnapshot | null> {
  const { data, error } = await supabase
    .from("investment_snapshots")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function list(supabase: SupabaseClient): Promise<InvestmentSnapshot[]> {
  const { data, error } = await supabase.from("investment_snapshots").select("*");

  if (error) {
    throw error;
  }

  return data || [];
}

export async function insert(supabase: SupabaseClient, snapshot: Omit<InvestmentSnapshot, "id" | "created_at">): Promise<InvestmentSnapshot> {
  const { data, error } = await supabase
    .from("investment_snapshots")
    .insert(snapshot)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function update(supabase: SupabaseClient, id: string, snapshot: Partial<Omit<InvestmentSnapshot, "id" | "created_at">>): Promise<InvestmentSnapshot> {
  const { data, error } = await supabase
    .from("investment_snapshots")
    .update(snapshot)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function remove(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("investment_snapshots").delete().eq("id", id);

  if (error) {
    throw error;
  }
}
