import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExchangeRate } from "@/domain/exchange-rate";

export async function getById(supabase: SupabaseClient, id: string): Promise<ExchangeRate | null> {
  const { data, error } = await supabase
    .from("exchange_rates")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function list(supabase: SupabaseClient): Promise<ExchangeRate[]> {
  const { data, error } = await supabase.from("exchange_rates").select("*");

  if (error) {
    throw error;
  }

  return data || [];
}

export async function insert(supabase: SupabaseClient, rate: Omit<ExchangeRate, "id" | "created_at">): Promise<ExchangeRate> {
  const { data, error } = await supabase
    .from("exchange_rates")
    .insert(rate)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function update(supabase: SupabaseClient, id: string, rate: Partial<Omit<ExchangeRate, "id" | "created_at">>): Promise<ExchangeRate> {
  const { data, error } = await supabase
    .from("exchange_rates")
    .update(rate)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function remove(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("exchange_rates").delete().eq("id", id);

  if (error) {
    throw error;
  }
}
