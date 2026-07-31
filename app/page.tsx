import { createServerSupabaseClient } from "@/lib/supabase";
import { accountRepository, projectRepository } from "@/repositories";
import { getNetCashPosition } from "@/services/finance/net-cash.service";
import { getCategorySpend } from "@/services/finance/category-spend.service";
import { getMonthBudget, sumExpenseBudget } from "@/services/finance/budget.service";
import { getRecentTransactions } from "@/services/finance/activity.service";
import { getMonthlyIncomeSgd, computeBudgetPace, buildAttentionItems } from "@/services/finance/dashboard.service";
import { listInboxItems } from "@/services/capture/inbox.service";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { buildAccountNameMap } from "@/components/activity/activity-format";

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

  const [accounts, projects, categorySpend, recentTransactions, inboxItems, monthlyIncomeSgd] = await Promise.all([
    accountRepository.list(supabase),
    projectRepository.list(supabase),
    getCategorySpend(supabase, start, end),
    getRecentTransactions(supabase, 7),
    listInboxItems(supabase),
    getMonthlyIncomeSgd(supabase, start, end),
  ]);

  const netCash = await getNetCashPosition(supabase, accounts);
  const monthlyExpenseSgd = categorySpend.reduce((sum, c) => sum + c.sgdAmount, 0);

  const genericProject = projects.find((p) => p.project_name === "Generic");
  let budget: { budgetedSgd: number; spentSgd: number; isCarriedForward: boolean; sourceMonth: string | null } | null = null;

  if (genericProject) {
    const monthBudget = await getMonthBudget(supabase, genericProject.id, start);
    budget = {
      budgetedSgd: sumExpenseBudget(monthBudget),
      spentSgd: monthlyExpenseSgd,
      isCarriedForward: monthBudget.isCarriedForward,
      sourceMonth: monthBudget.sourceMonth,
    };
  }

  const budgetPace = budget ? computeBudgetPace(budget.spentSgd, budget.budgetedSgd, new Date(), start, end) : null;
  const failedCaptureCount = inboxItems.filter((i) => i.status === "Failed").length;
  const attentionItems = buildAttentionItems({
    failedCaptureCount,
    unconvertedCurrencies: netCash.unconvertedCurrencies,
    budgetPace,
    topCategory: categorySpend[0] ?? null,
  });

  return (
    <DashboardView
      monthLabel={label}
      netCash={netCash}
      budget={budget}
      estimatedMonthlySavings={round2(monthlyIncomeSgd - monthlyExpenseSgd)}
      budgetPace={budgetPace}
      attentionItems={attentionItems}
      recentTransactions={recentTransactions}
      accountNameById={buildAccountNameMap(accounts)}
    />
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
