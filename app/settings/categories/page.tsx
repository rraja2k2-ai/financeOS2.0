import { createServerSupabaseClient } from "@/lib/supabase";
import { categorizationRuleRepository } from "@/repositories";
import { CategoriesView } from "@/components/settings/CategoriesView";

export default async function CategoriesSettingsPage() {
  const supabase = await createServerSupabaseClient();
  const rules = await categorizationRuleRepository.list(supabase);

  const byPrimary = new Map<string, Set<string>>();
  for (const rule of rules) {
    if (!byPrimary.has(rule.primary_category)) byPrimary.set(rule.primary_category, new Set());
    if (rule.secondary_category) byPrimary.get(rule.primary_category)!.add(rule.secondary_category);
  }

  const categories = Array.from(byPrimary.entries())
    .map(([primary, secondarySet]) => ({ primary, secondaries: Array.from(secondarySet).sort() }))
    .sort((a, b) => a.primary.localeCompare(b.primary));

  return <CategoriesView categories={categories} />;
}
