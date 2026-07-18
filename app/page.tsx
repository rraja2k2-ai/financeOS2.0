import { createServerSupabaseClient } from "@/lib/supabase";
import { accountRepository, projectRepository } from "@/repositories";
import { getNetCashPosition } from "@/services/finance/net-cash.service";
import { getCategorySpend } from "@/services/finance/category-spend.service";
import { getMonthBudget, sumExpenseBudget } from "@/services/finance/budget.service";
import { getRecentTransactions } from "@/services/finance/activity.service";
import { DashboardView } from "@/components/dashboard/DashboardView";

function currentMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  const label = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return { start, end, label };
}

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const { start, end, label } = currentMonthRange();

  const [accounts, projects, categorySpend, recentTransactions] = await Promise.all([
    accountRepository.list(supabase),
    projectRepository.list(supabase),
    getCategorySpend(supabase, start, end),
    getRecentTransactions(supabase, 7),
  ]);

  const netCash = await getNetCashPosition(supabase, accounts);

  const genericProject = projects.find((p) => p.project_name === "Generic");
  let budget: { budgetedSgd: number; spentSgd: number; isCarriedForward: boolean; sourceMonth: string | null } | null = null;

  if (genericProject) {
    const monthBudget = await getMonthBudget(supabase, genericProject.id, start);
    const spentSgd = categorySpend.reduce((sum, c) => sum + c.sgdAmount, 0);
    budget = {
      budgetedSgd: sumExpenseBudget(monthBudget),
      spentSgd,
      isCarriedForward: monthBudget.isCarriedForward,
      sourceMonth: monthBudget.sourceMonth,
    };
  }

  return (
    <DashboardView
      monthLabel={label}
      netCash={netCash}
      categorySpend={categorySpend}
      budget={budget}
      recentTransactions={recentTransactions}
    />
  );
}
