export const SUPPORTED_TARGET_CURRENCIES = ["INR", "USD", "MYR", "THB", "EUR", "VND", "IDR"] as const;
export type TargetCurrency = (typeof SUPPORTED_TARGET_CURRENCIES)[number];

/**
 * Base Currency options. There is exactly one active base currency across the whole app,
 * and it is the single source of truth stored in exchange_rates.base_currency (every row
 * shares the same value). Default is SGD when no rates exist yet.
 */
export const BASE_CURRENCIES = ["SGD", "INR"] as const;
export type BaseCurrency = (typeof BASE_CURRENCIES)[number];
export const DEFAULT_BASE_CURRENCY: BaseCurrency = "SGD";

export type ExchangeRate = {
  id: string;
  base_currency: string;
  target_currency: string;
  rate: string;
  rate_date: string;
  source: string;
  last_updated: string;
  created_at: string;
};
