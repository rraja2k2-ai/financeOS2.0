/**
 * Central "is this a genuine expense?" filter — the single source of truth for
 * excluding money-movement transactions (income, transfers, cash withdrawals, credit
 * card payments, balance corrections) from expense analytics, Top Categories, Budget
 * calculations, and spending summaries. These are NOT expenses — they move money
 * between your own accounts/liabilities or into an account from outside, they don't
 * represent spend.
 *
 * UAT Defect Fix (Posting Engine milestone): the five-value Transaction Type
 * Architecture (constants/transaction-types.ts) makes transaction_type a fully
 * reliable signal on every row (docs/database/migrations/017's CHECK constraint is
 * validated, no legacy value remains) — so this is a strict positive check against
 * transaction_type alone. Only EXPENSE counts as spend; category name is never
 * consulted (a category-name backstop existed here previously and incorrectly let
 * INCOME/ADJUSTMENT rows through as spend since their categories weren't in the
 * backstop's list — transaction_type is the only source of truth now).
 *
 * Deliberately NOT applied to raw activity feeds (Dashboard's Recent Transactions,
 * Activity's browsable list) — those are a ledger of everything that happened, where
 * seeing a transfer or income row is legitimate information. Only apply this where
 * the surface is specifically expense analytics (Spend totals, Top Categories, Budget).
 */
import { TRANSACTION_TYPES } from "@/constants/transaction-types";

export type ExpenseFilterable = {
  transaction_type: string;
  primary_category: string | null;
};

/** Header-level check — the ONLY correct way to determine if a transaction counts as spend. */
export function isExpenseTransaction(header: ExpenseFilterable): boolean {
  return header.transaction_type === TRANSACTION_TYPES.EXPENSE;
}
