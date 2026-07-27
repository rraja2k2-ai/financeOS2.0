import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase";
import { accountRepository } from "@/repositories";
import { getAccountPeriodSummary, getRecentTransactionsForAccount } from "@/services/finance/account-detail.service";
import { AccountDetailView } from "@/components/accounts/AccountDetailView";
import { buildAccountNameMap } from "@/components/activity/activity-format";
import { resolvePeriodRange, PERIOD_OPTIONS, type PeriodKey } from "@/lib/period";

// Recent Transactions relies on server-recomputed summary/preview per period change
// (unlike Activity's client-filtered list), so this always re-renders on navigation —
// same reasoning as Activity/Inbox's own dynamic export.
export const dynamic = "force-dynamic";

const RECENT_LIMIT = 5;

function isPeriodKey(value: string | undefined): value is PeriodKey {
  return !!value && PERIOD_OPTIONS.some((p) => p.key === value);
}

export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { id } = await params;
  const { period: periodParam, from, to } = await searchParams;
  const period: PeriodKey = isPeriodKey(periodParam) ? periodParam : "this-month";

  const supabase = await createServerSupabaseClient();
  const account = await accountRepository.getById(supabase, id).catch(() => null);
  if (!account) notFound();

  const { start, end } = resolvePeriodRange(period, from, to);

  const [summary, recentTransactions, allAccounts] = await Promise.all([
    getAccountPeriodSummary(supabase, id, start, end),
    getRecentTransactionsForAccount(supabase, id, start, end, RECENT_LIMIT),
    accountRepository.list(supabase),
  ]);

  return (
    <AccountDetailView
      account={account}
      summary={summary}
      recentTransactions={recentTransactions}
      period={period}
      customStart={from ?? ""}
      customEnd={to ?? ""}
      accountNameById={buildAccountNameMap(allAccounts)}
    />
  );
}
