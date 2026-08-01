/**
 * Capture-session master data loader (C2).
 *
 * Loaded ONCE per Capture Session, then passed into processCapture() and reused for the
 * whole session — no further Supabase queries happen after this. (In V1 a session makes
 * exactly one AI call, so "once per session" = one load per Capture & Process press.)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  accountRepository,
  accountMappingRuleRepository,
  projectRepository,
  categorizationRuleRepository,
  exchangeRateRepository,
} from "@/repositories";
import { listCategoryMaster } from "@/services/finance/budget.service";
import { GENERIC_PROJECT_NAME } from "@/domain/project";
import { DEFAULT_BASE_CURRENCY } from "@/domain/exchange-rate";
import type { CaptureMasterData } from "@/services/ai/ai-provider";

export async function loadCaptureMasterData(supabase: SupabaseClient): Promise<CaptureMasterData> {
  const [accounts, projects, rules, accountMappingRules, baseCurrency] = await Promise.all([
    accountRepository.list(supabase),
    projectRepository.list(supabase),
    categorizationRuleRepository.list(supabase),
    accountMappingRuleRepository.list(supabase),
    exchangeRateRepository.getBaseCurrency(supabase),
  ]);

  // Category Master (Decisions 4/5/6) — the Generic project's project_budgets rows are
  // the one source of truth for "what categories exist," replacing the old hardcoded
  // CATEGORY_TAXONOMY. Grouped by (primary, categoryType) to match the shape Capture's AI
  // prompt already expects — "Investments" legitimately appears twice, once per side,
  // exactly as CATEGORY_TAXONOMY itself used to encode it.
  const genericProjectId = projects.find((p) => p.project_name === GENERIC_PROJECT_NAME)?.id ?? null;
  const categoryMaster = genericProjectId ? await listCategoryMaster(supabase, genericProjectId) : [];
  const categoriesByGroup = new Map<string, { primary: string; categoryType: "income" | "expense"; subcategories: string[] }>();
  for (const entry of categoryMaster) {
    const key = `${entry.primary}::${entry.categoryType}`;
    if (!categoriesByGroup.has(key)) categoriesByGroup.set(key, { primary: entry.primary, categoryType: entry.categoryType, subcategories: [] });
    if (entry.secondary) categoriesByGroup.get(key)!.subcategories.push(entry.secondary);
  }

  return {
    baseCurrency: baseCurrency ?? DEFAULT_BASE_CURRENCY,
    categories: Array.from(categoriesByGroup.values()),
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
    accountMappingRules: accountMappingRules
      .filter((r) => r.is_active)
      .map((r) => ({
        keyword: r.keyword,
        account: r.mapped_account,
      })),
  };
}
