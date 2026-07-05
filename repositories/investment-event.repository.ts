import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvestmentEvent } from "@/domain/investment-event";

export async function getById(supabase: SupabaseClient, id: string): Promise<InvestmentEvent | null> {
  const { data, error } = await supabase
    .from("investment_events")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function list(supabase: SupabaseClient): Promise<InvestmentEvent[]> {
  const { data, error } = await supabase.from("investment_events").select("*");

  if (error) {
    throw error;
  }

  return data || [];
}

export async function insert(supabase: SupabaseClient, event: Omit<InvestmentEvent, "id" | "created_at">): Promise<InvestmentEvent> {
  const { data, error } = await supabase
    .from("investment_events")
    .insert(event)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function update(supabase: SupabaseClient, id: string, event: Partial<Omit<InvestmentEvent, "id" | "created_at">>): Promise<InvestmentEvent> {
  const { data, error } = await supabase
    .from("investment_events")
    .update(event)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function remove(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("investment_events").delete().eq("id", id);

  if (error) {
    throw error;
  }
}
