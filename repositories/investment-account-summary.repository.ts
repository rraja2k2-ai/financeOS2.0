import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvestmentAccountSummary } from "@/domain/investment-account-summary";

export async function getById(supabase: SupabaseClient, accountId: string): Promise<InvestmentAccountSummary | null> {
  const { data, error } = await supabase
    .from("investment_account_summary")
    .select("*")
    .eq("account_id", accountId)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function list(supabase: SupabaseClient): Promise<InvestmentAccountSummary[]> {
  const { data, error } = await supabase.from("investment_account_summary").select("*");

  if (error) {
    throw error;
  }

  return data || [];
}

export async function insert(supabase: SupabaseClient, summary: Omit<InvestmentAccountSummary, "updated_at">): Promise<InvestmentAccountSummary> {
  const { data, error } = await supabase
    .from("investment_account_summary")
    .insert(summary)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function update(supabase: SupabaseClient, accountId: string, summary: Partial<Omit<InvestmentAccountSummary, "account_id" | "updated_at">>): Promise<InvestmentAccountSummary> {
  const { data, error } = await supabase
    .from("investment_account_summary")
    .update(summary)
    .eq("account_id", accountId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function remove(supabase: SupabaseClient, accountId: string): Promise<void> {
  const { error } = await supabase.from("investment_account_summary").delete().eq("account_id", accountId);

  if (error) {
    throw error;
  }
}
