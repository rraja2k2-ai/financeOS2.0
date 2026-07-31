import { createServerSupabaseClient } from "@/lib/supabase";
import { accountRepository, projectRepository } from "@/repositories";
import { getNetCashPosition } from "@/services/finance/net-cash.service";
import { getCategorySpend } from "@/services/finance/category-spend.service";
import { getMonthBudget, sumExpenseBudget } from "@/services/finance/budget.service";
import { getRecentTransactions } from "@/services/finance/activity.service";
import { getMonthlyIncomeAndExpense, computeBudgetPace, computeBudgetRemainingSgd, buildAttentionItems, round2 } from "@/services/finance/dashboard.service";
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

  const [accounts, projects, categorySpend, recentTransactions, inboxItems, monthlyIncomeAndExpense] = await Promise.all([
    accountRepository.list(supabase),
    projectRepository.list(supabase),
    // Still needed separately: the Attention section's "highest contributing category"
    // requires the item-level breakdown only category-spend.service provides — headers
    // alone (below) can't produce it. Not a leftover duplicate of that call: this fetch
    // and monthlyIncomeAndExpense now serve two genuinely different needs (category
    // breakdown vs. household income/expense totals) instead of both re-deriving the
    // same total independently the way the pre-fix version did.
    getCategorySpend(supabase, start, end),
    getRecentTransactions(supabase, 7),
    listInboxItems(supabase),
    getMonthlyIncomeAndExpense(supabase, start, end),
  ]);

  const netCash = await getNetCashPosition(supabase, accounts);

  const genericProject = projects.find((p) => p.project_name === "Generic");
  let budget: { budgetedSgd: number; spentSgd: number; remainingSgd: number; isCarriedForward: boolean; sourceMonth: string | null } | null = null;

  if (genericProject) {
    const monthBudget = await getMonthBudget(supabase, genericProject.id, start);
    const budgetedSgd = sumExpenseBudget(monthBudget);
    const spentSgd = monthlyIncomeAndExpense.expenseSgd;
    budget = {
      budgetedSgd,
      spentSgd,
      remainingSgd: computeBudgetRemainingSgd(budgetedSgd, spentSgd),
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
      estimatedMonthlySavings={round2(monthlyIncomeAndExpense.incomeSgd - monthlyIncomeAndExpense.expenseSgd)}
      budgetPace={budgetPace}
      attentionItems={attentionItems}
      recentTransactions={recentTransactions}
      accountNameById={buildAccountNameMap(accounts)}
    />
  );
}
