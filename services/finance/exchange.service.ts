/**
 * Currency Converter / Exchange Rate service.
 * Deterministic, server-only. The active Base Currency is the single source of truth stored
 * in exchange_rates.base_currency (every row shares the same value). exchange_rates stores
 * base_currency=B, target_currency=X, meaning 1 B = rate X — so converting a native amount
 * back to the base currency is amount / rate.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as exchangeRateRepository from "@/repositories/exchange-rate.repository";
import { DEFAULT_BASE_CURRENCY } from "@/domain/exchange-rate";

export type CurrencyConversion = {
  /** Amount expressed in the active base currency. */
  baseAmount: number;
  /** Rate used, or null when the amount is already in the base currency (no conversion needed). */
  exchangeRate: number | null;
};

export class ExchangeRateNotFoundError extends Error {
  constructor(currency: string, baseCurrency: string) {
    super(`No ${baseCurrency} exchange rate found for currency "${currency}". Add one in Settings > Exchange Rates before saving.`);
    this.name = "ExchangeRateNotFoundError";
  }
}

/**
 * Converts `amount` in `currency` to the app's current Base Currency. Fields elsewhere in
 * the codebase named `sgd`/`sgdAmount` predate the configurable Base Currency and still
 * assume SGD display-wise — only the exchange-rate lookup itself is base-currency-aware.
 */
export async function convertToBaseCurrency(
  supabase: SupabaseClient,
  amount: number,
  currency: string
): Promise<CurrencyConversion> {
  const baseCurrency = (await exchangeRateRepository.getBaseCurrency(supabase)) ?? DEFAULT_BASE_CURRENCY;

  if (currency.toUpperCase() === baseCurrency) {
    return { baseAmount: round2(amount), exchangeRate: null };
  }

  const rate = await exchangeRateRepository.getLatestRate(supabase, currency.toUpperCase(), baseCurrency);
  if (!rate) {
    throw new ExchangeRateNotFoundError(currency, baseCurrency);
  }

  const rateValue = Number(rate.rate);
  return { baseAmount: round2(amount / rateValue), exchangeRate: rateValue };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
