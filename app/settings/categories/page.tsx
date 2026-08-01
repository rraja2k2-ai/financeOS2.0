import { createServerSupabaseClient } from "@/lib/supabase";
import { projectRepository } from "@/repositories";
import { listCategoryMaster } from "@/services/finance/budget.service";
import { GENERIC_PROJECT_NAME } from "@/domain/project";
import { CategoriesView } from "@/components/settings/CategoriesView";

/**
 * Decision 6 — read-only reference only. Category maintenance (create/rename/archive)
 * lives entirely in Budget now; this page just shows the same Category Master (Generic
 * project's project_budgets rows) Capture/AI/Review already read, so there is exactly one
 * place categories are defined and this page can never drift from it the way the old
 * categorization_rules-derived view could.
 */
export default async function CategoriesSettingsPage() {
  const supabase = await createServerSupabaseClient();
  const projects = await projectRepository.list(supabase);
  const genericProjectId = projects.find((p) => p.project_name === GENERIC_PROJECT_NAME)?.id ?? null;
  const master = genericProjectId ? await listCategoryMaster(supabase, genericProjectId, true) : [];

  const byPrimary = new Map<string, Set<string>>();
  for (const entry of master) {
    if (!byPrimary.has(entry.primary)) byPrimary.set(entry.primary, new Set());
    if (entry.secondary) byPrimary.get(entry.primary)!.add(entry.isArchived ? `${entry.secondary} (archived)` : entry.secondary);
  }

  const categories = Array.from(byPrimary.entries())
    .map(([primary, secondarySet]) => ({ primary, secondaries: Array.from(secondarySet).sort() }))
    .sort((a, b) => a.primary.localeCompare(b.primary));

  return <CategoriesView categories={categories} />;
}
