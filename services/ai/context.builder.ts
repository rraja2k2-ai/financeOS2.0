/**
 * AI Context Builder (TAD-002 §4.4).
 *
 * Sits between the Orchestrator and the AI services. Loads only the master data
 * relevant to the current request — active accounts, active projects, and the
 * category taxonomy — and assembles the minimal context Phase 2 needs. The AI never
 * sees UUIDs, exchange rates, or the full database: only names it can suggest, which
 * the server later resolves to real account_id/project_id (TAD-005 §4).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountRepository, projectRepository } from "@/repositories";
import { CATEGORY_TAXONOMY } from "@/constants/categories";
import type { CategoryOption } from "@/types/ai";

export type ClassificationContext = {
  /** Active account names + currency, e.g. "POSB Bank (SGD)". Names only — no ids. */
  accountNames: string[];
  /** Active project names, e.g. "Generic", "India Trip 2026". Names only — no ids. */
  projectNames: string[];
  categories: CategoryOption[];
};

export async function buildClassificationContext(supabase: SupabaseClient): Promise<ClassificationContext> {
  const [accounts, projects] = await Promise.all([
    accountRepository.list(supabase),
    projectRepository.list(supabase),
  ]);

  const accountNames = accounts
    .filter((a) => a.status === "Active")
    .map((a) => `${a.account_name} (${a.currency})`);

  const projectNames = projects.filter((p) => p.status === "Active").map((p) => p.project_name);

  const categories: CategoryOption[] = CATEGORY_TAXONOMY.filter((c) => c.categoryType === "expense").map(
    (c) => ({ primary: c.primary, subcategories: c.subcategories })
  );

  return { accountNames, projectNames, categories };
}
