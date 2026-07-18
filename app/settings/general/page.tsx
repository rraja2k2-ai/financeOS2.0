import { createServerSupabaseClient } from "@/lib/supabase";
import { exchangeRateRepository } from "@/repositories";
import { BASE_CURRENCIES, DEFAULT_BASE_CURRENCY, type BaseCurrency } from "@/domain/exchange-rate";
import { GeneralView } from "@/components/settings/GeneralView";

export default async function GeneralSettingsPage() {
  const supabase = await createServerSupabaseClient();
  const stored = await exchangeRateRepository.getBaseCurrency(supabase);
  const baseCurrency: BaseCurrency = (BASE_CURRENCIES as readonly string[]).includes(stored ?? "")
    ? (stored as BaseCurrency)
    : DEFAULT_BASE_CURRENCY;

  return <GeneralView baseCurrency={baseCurrency} />;
}
