import { createServerSupabaseClient } from "@/lib/supabase";
import { projectRepository } from "@/repositories";
import { ensureMonthBudget, sumExpenseBudget, combineBudgetVsActual, listCategoryMaster } from "@/services/finance/budget.service";
import { getCategorySpend } from "@/services/finance/category-spend.service";
import { monthBounds, startOfMonthIso } from "@/lib/period";
import { BudgetView } from "@/components/budget/BudgetView";

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;
  const month = monthParam || startOfMonthIso();
  const { start, end } = monthBounds(month);

  const supabase = await createServerSupabaseClient();

  // The Monthly Budget module now covers only the Generic project (household monthly
  // spending). Per-project budgets live entirely in the Project module (/projects).
  const projects = await projectRepository.list(supabase);
  const genericProject = projects.find((p) => p.project_name === "Generic" && p.status === "Active");

  const categorySpend = await getCategorySpend(supabase, start, end);

  let categories: ReturnType<typeof combineBudgetVsActual> = [];
  let sourceMonth: string | null = null;
  let totalBudgetedSgd = 0;
  let existingPrimaries: string[] = [];
  let existingSecondaries: string[] = [];
  let archivedCategories: { primary: string; secondary: string | null }[] = [];

  // Opening a month with no budget yet auto-copies the nearest earlier month's budget
  // (categories, subcategories, amounts, currency — never actuals) as a real write, then
  // opens the newly created month. A month that already has rows opens directly.
  if (genericProject) {
    const monthBudget = await ensureMonthBudget(supabase, genericProject.id, month);
    categories = combineBudgetVsActual(monthBudget, categorySpend);
    sourceMonth = monthBudget.sourceMonth;
    totalBudgetedSgd = sumExpenseBudget(monthBudget);

    // Category Master (Decisions 4/5/6) — feeds the Add Category form's "existing"
    // pickers (v1.8.0 Budget UX) and the Archived Categories / Restore list. Active-only
    // for the pickers (picking an archived name should go through Restore, not a silent
    // revive); includeArchived for the restore list.
    const master = await listCategoryMaster(supabase, genericProject.id, true);
    existingPrimaries = Array.from(new Set(master.filter((m) => !m.isArchived).map((m) => m.primary))).sort((a, b) => a.localeCompare(b));
    existingSecondaries = Array.from(
      new Set(master.filter((m) => !m.isArchived && m.secondary).map((m) => m.secondary as string))
    ).sort((a, b) => a.localeCompare(b));
    archivedCategories = master
      .filter((m) => m.isArchived)
      .map((m) => ({ primary: m.primary, secondary: m.secondary }))
      .sort((a, b) => a.primary.localeCompare(b.primary) || (a.secondary ?? "").localeCompare(b.secondary ?? ""));
  }

  const totalActualSgd = categorySpend.reduce((sum, c) => sum + c.sgdAmount, 0);

  return (
    <BudgetView
      month={month}
      projectId={genericProject?.id ?? null}
      totalBudgetedSgd={totalBudgetedSgd}
      totalActualSgd={totalActualSgd}
      sourceMonth={sourceMonth}
      categories={categories}
      existingPrimaries={existingPrimaries}
      existingSecondaries={existingSecondaries}
      archivedCategories={archivedCategories}
    />
  );
}
