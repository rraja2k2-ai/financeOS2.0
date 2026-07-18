"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase";
import { exchangeRateRepository } from "@/repositories";
import type { BaseCurrency } from "@/domain/exchange-rate";

/**
 * Changes the app's Base Currency. exchange_rates.base_currency is the single source of
 * truth, so this is a straight relabel of every row: UPDATE exchange_rates SET
 * base_currency = <selected>. Rates/targets are untouched — no previously calculated value
 * changes, only future lookups (which filter on the new base) are affected.
 */
export async function updateBaseCurrencyAction(baseCurrency: BaseCurrency) {
  const supabase = await createServerSupabaseClient();
  await exchangeRateRepository.updateAllBaseCurrency(supabase, baseCurrency);

  revalidatePath("/settings/general");
  revalidatePath("/settings/exchange-rates");
}

export type ExchangeRateInput = { targetCurrency: string; rate: string };

/**
 * Saves every edited exchange rate at once (Save All). Blank rates are skipped; all
 * non-blank rates are validated up front, then upserted in a single batch so nothing is
 * partially saved. last_updated is stamped on each.
 */
export async function saveAllExchangeRatesAction(baseCurrency: string, rows: ExchangeRateInput[]) {
  const toSave = rows.filter((r) => String(r.rate ?? "").trim() !== "");

  for (const r of toSave) {
    const value = Number(r.rate);
    if (Number.isNaN(value) || value <= 0) {
      throw new Error(`Exchange rate for ${r.targetCurrency} must be a positive number.`);
    }
  }

  const supabase = await createServerSupabaseClient();
  const rateDate = new Date().toISOString().slice(0, 10);
  await exchangeRateRepository.upsertRates(
    supabase,
    toSave.map((r) => ({
      base_currency: baseCurrency,
      target_currency: r.targetCurrency,
      rate: r.rate,
      rate_date: rateDate,
      source: "manual",
    }))
  );

  revalidatePath("/settings/exchange-rates");
}
