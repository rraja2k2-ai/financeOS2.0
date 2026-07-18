/**
 * Capture-session master data loader (C2).
 *
 * Loaded ONCE per Capture Session, then passed into processCapture() and reused for the
 * whole session — no further Supabase queries happen after this. (In V1 a session makes
 * exactly one AI call, so "once per session" = one load per Capture & Process press.)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountRepository, projectRepository, categorizationRuleRepository, exchangeRateRepository } from "@/repositories";
import { CATEGORY_TAXONOMY } from "@/constants/categories";
import { DEFAULT_BASE_CURRENCY } from "@/domain/exchange-rate";
import type { CaptureMasterData } from "@/services/ai/ai-provider";

export async function loadCaptureMasterData(supabase: SupabaseClient): Promise<CaptureMasterData> {
  const [accounts, projects, rules, baseCurrency] = await Promise.all([
    accountRepository.list(supabase),
    projectRepository.list(supabase),
    categorizationRuleRepository.list(supabase),
    exchangeRateRepository.getBaseCurrency(supabase),
  ]);

  return {
    baseCurrency: baseCurrency ?? DEFAULT_BASE_CURRENCY,
    // The canonical taxonomy is code-defined (constants/categories.ts) — all entries active.
    categories: CATEGORY_TAXONOMY.map((c) => ({
      primary: c.primary,
      categoryType: c.categoryType,
      subcategories: c.subcategories,
    })),
    accounts: accounts
      .filter((a) => a.status === "Active")
      .map((a) => ({ name: a.account_name, type: a.account_type, currency: a.currency })),
    projects: projects
      .filter((p) => p.status === "Active")
      .map((p) => ({ name: p.project_name, description: p.description ?? null })),
    categorizationRules: rules
      .filter((r) => r.is_active)
      .map((r) => ({
        merchantPattern: r.merchant_pattern,
        primaryCategory: r.primary_category,
        secondaryCategory: r.secondary_category,
        accountHint: r.default_account_hint,
      })),
  };
}
