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

/** Most recent baseCurrency -> targetCurrency rate on or before `rate_date`. Null if none exists yet. */
export async function getLatestRate(
  supabase: SupabaseClient,
  targetCurrency: string,
  baseCurrency: string = "SGD"
): Promise<ExchangeRate | null> {
  const { data, error } = await supabase
    .from("exchange_rates")
    .select("*")
    .eq("base_currency", baseCurrency)
    .eq("target_currency", targetCurrency)
    .order("rate_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * The single active base currency, read straight from exchange_rates.base_currency (every
 * row shares the same value — the invariant enforced by updateAllBaseCurrency). Null when
 * no rates exist yet; callers default to SGD.
 */
export async function getBaseCurrency(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.from("exchange_rates").select("base_currency").limit(1).maybeSingle();

  if (error) {
    throw error;
  }

  return data?.base_currency ?? null;
}

/** All rates for the given base currency (Settings > Exchange Rates screen). */
export async function listByBase(supabase: SupabaseClient, baseCurrency: string): Promise<ExchangeRate[]> {
  const { data, error } = await supabase
    .from("exchange_rates")
    .select("*")
    .eq("base_currency", baseCurrency)
    .order("target_currency", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Relabels every existing row's base_currency to `newBaseCurrency`. Per product rule this
 * is a straight column update only — rate/rate_date/target_currency are left untouched so
 * no previously calculated value changes; only future lookups (which filter on the new
 * base_currency) are affected.
 */
export async function updateAllBaseCurrency(supabase: SupabaseClient, newBaseCurrency: string): Promise<void> {
  const { error } = await supabase.from("exchange_rates").update({ base_currency: newBaseCurrency }).neq("base_currency", newBaseCurrency);

  if (error) {
    throw error;
  }
}

export type ExchangeRateUpsert = {
  base_currency: string;
  target_currency: string;
  rate: string;
  rate_date: string;
  source: string;
};

/**
 * Batch UPSERT on the (base_currency, target_currency) pair — overwrites each pair's rate
 * (no history kept) and stamps last_updated. Powers the Exchange Rates screen's single
 * "Save All". Requires the unique index added in migration 009.
 */
export async function upsertRates(supabase: SupabaseClient, rates: ExchangeRateUpsert[]): Promise<void> {
  if (rates.length === 0) return;

  const stamped = new Date().toISOString();
  const { error } = await supabase
    .from("exchange_rates")
    .upsert(
      rates.map((r) => ({ ...r, last_updated: stamped })),
      { onConflict: "base_currency,target_currency" }
    );

  if (error) {
    throw error;
  }
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
