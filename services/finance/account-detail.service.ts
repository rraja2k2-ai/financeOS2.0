/**
 * Account Detail page (FinanceOS 2.0 — Accounts Detail Enhancement). Two independent
 * reads so Recent Transactions never pays for the full period dataset (§7 Performance):
 * the summary counts/sums headers only (no items), while the preview fetches exactly
 * `limit` headers and only that limit's items.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as transactionHeaderRepository from "@/repositories/transaction-header.repository";
import * as transactionItemRepository from "@/repositories/transaction-item.repository";
import { isExpenseTransaction } from "@/lib/expense-filter";
import { categoryTypeFor } from "@/constants/categories";
import { convertFromBaseCurrency } from "./exchange.service";
import { toActivityTransaction, type ActivityTransaction } from "./activity.service";

export type AccountPeriodSummary = {
  income: number;
  expenses: number;
  netChange: number;
  transactionCount: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Income/Expenses/Net Change/Count for one account over [startDate, endDate] — headers
 *  only, reusing the same Expense classifier as category-spend.service.ts and the same
 *  Income classifier (categoryTypeFor) already used by Budget planning. */
export async function getAccountPeriodSummary(
  supabase: SupabaseClient,
  accountId: string,
  startDate: string,
  endDate: string
): Promise<AccountPeriodSummary> {
  const headers = await transactionHeaderRepository.listByAccountId(supabase, accountId, { startDate, endDate });

  let income = 0;
  let expenses = 0;
  for (const header of headers) {
    const amount = Number(header.sgd_total_amount);
    if (isExpenseTransaction(header)) {
      expenses += amount;
    } else if (categoryTypeFor(header.primary_category) === "income") {
      income += amount;
    }
  }

  return {
    income: round2(income),
    expenses: round2(expenses),
    netChange: round2(income - expenses),
    transactionCount: headers.length,
  };
}

/** Newest `limit` transactions for one account in [startDate, endDate], items included —
 *  the Recent Transactions preview. Never fetches beyond `limit` headers/items.
 *  `accountCurrency` powers the Cross-Currency Display bug fix below — pass the already-
 *  loaded account's own currency (the caller already fetched the account row, so this is
 *  a zero-extra-query parameter, not a new lookup). */
export async function getRecentTransactionsForAccount(
  supabase: SupabaseClient,
  accountId: string,
  accountCurrency: string,
  startDate: string,
  endDate: string,
  limit: number
): Promise<ActivityTransaction[]> {
  const headers = await transactionHeaderRepository.listByAccountId(supabase, accountId, { startDate, endDate, limit });
  if (headers.length === 0) return [];

  const items = await transactionItemRepository.listByHeaderIds(
    supabase,
    headers.map((h) => h.id)
  );

  const itemsByHeader = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.header_id) continue;
    if (!itemsByHeader.has(item.header_id)) itemsByHeader.set(item.header_id, []);
    itemsByHeader.get(item.header_id)!.push(item);
  }

  const transactions = headers.map((header) => toActivityTransaction(header, itemsByHeader.get(header.id) ?? []));

  // Bug Fix (Account Details Cross-Currency Display) — a transaction recorded in a
  // currency other than the account being viewed (e.g. a POSB Bank (SGD) -> Cash - INR
  // Transfer, viewed from Cash - INR) previously had no amount in the account's own
  // currency at all, so TransactionCard fell back to a bare SGD figure with no account
  // context. Reuses the same reverse exchange-rate lookup the Account Posting Engine
  // already relies on for a cross-currency destination's own-currency delta (CLAUDE.md
  // §11 Parking Lot — "no schema change needed") — never a second conversion design.
  // `limit` bounds this to a handful of rows (the Recent Transactions preview), so one
  // lookup per qualifying row is the existing service call, not a new N+1 pattern. A
  // missing exchange rate degrades gracefully (§6) — the row just falls back to
  // TransactionCard's existing SGD display instead of failing the whole page.
  return Promise.all(
    transactions.map(async (t) => {
      if (t.currency === accountCurrency) return t;
      try {
        const accountNativeAmount = await convertFromBaseCurrency(supabase, t.sgdAmount, accountCurrency);
        return { ...t, accountNativeAmount };
      } catch {
        return t;
      }
    })
  );
}
