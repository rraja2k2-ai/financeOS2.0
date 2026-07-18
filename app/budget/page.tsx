import { createServerSupabaseClient } from "@/lib/supabase";
import { projectRepository } from "@/repositories";
import { ensureMonthBudget, sumExpenseBudget, combineBudgetVsActual } from "@/services/finance/budget.service";
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

  // Opening a month with no budget yet auto-copies the nearest earlier month's budget
  // (categories, subcategories, amounts, currency — never actuals) as a real write, then
  // opens the newly created month. A month that already has rows opens directly.
  if (genericProject) {
    const monthBudget = await ensureMonthBudget(supabase, genericProject.id, month);
    categories = combineBudgetVsActual(monthBudget, categorySpend);
    sourceMonth = monthBudget.sourceMonth;
    totalBudgetedSgd = sumExpenseBudget(monthBudget);
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
    />
  );
}
