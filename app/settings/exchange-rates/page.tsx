import { createServerSupabaseClient } from "@/lib/supabase";
import { exchangeRateRepository } from "@/repositories";
import { SUPPORTED_TARGET_CURRENCIES, DEFAULT_BASE_CURRENCY } from "@/domain/exchange-rate";
import { ExchangeRatesView } from "@/components/settings/ExchangeRatesView";

export default async function ExchangeRatesSettingsPage() {
  const supabase = await createServerSupabaseClient();
  const baseCurrency = (await exchangeRateRepository.getBaseCurrency(supabase)) ?? DEFAULT_BASE_CURRENCY;
  const existingRates = await exchangeRateRepository.listByBase(supabase, baseCurrency);

  const rateByTarget = new Map(existingRates.map((r) => [r.target_currency, r]));

  // Never show the base currency as its own target (a base→base row is meaningless).
  const rows = SUPPORTED_TARGET_CURRENCIES.filter((target) => target !== baseCurrency).map((target) => {
    const existing = rateByTarget.get(target);
    return {
      targetCurrency: target,
      // `rate` is a numeric DB column that supabase-js returns as a number, so coerce to a
      // string — the view treats rates as editable text (and calls .trim() on them).
      rate: existing != null ? String(existing.rate) : "",
      lastUpdated: existing?.last_updated ?? null,
    };
  });

  return <ExchangeRatesView baseCurrency={baseCurrency} rows={rows} />;
}
