/**
 * Central "is this a genuine expense?" filter — the single source of truth for
 * excluding money-movement transactions (credit card payments, transfers, cash
 * withdrawals) from expense analytics, Top Categories, Budget calculations, and
 * spending summaries. These are NOT expenses — they move money between your own
 * accounts/liabilities, they don't represent spend.
 *
 * Two layers, since real data isn't consistently tagged:
 *   1. transaction_type: the primary, most reliable signal.
 *   2. primary_category name: a defensive backstop for rows where transaction_type
 *      might not be set correctly, or a category name itself unambiguously names a
 *      money movement regardless of type.
 *
 * Deliberately NOT applied to raw activity feeds (Dashboard's Recent Transactions,
 * Activity's browsable list/SGD-INR totals) — those are a ledger of everything that
 * happened, where seeing a credit card payment is legitimate information. Only
 * apply this where the surface is specifically expense analytics.
 */
import { TRANSACTION_TYPES } from "@/constants/transaction-types";

/**
 * Legacy Title Case values ("Payment", "Transfer", "Lending") have been migrated to the
 * Transaction Type Architecture's five-value uppercase set (docs/database/migrations/017
 * — all mapped to TRANSFER) and the CHECK constraint is now fully validated, so no
 * fallback for the old strings is needed here anymore.
 */
const NON_EXPENSE_TRANSACTION_TYPES = new Set<string>([TRANSACTION_TYPES.TRANSFER]);

const NON_EXPENSE_CATEGORIES = new Set([
  "Financial",
  "Loans / Financial",
  "Credit Card Payment",
  "Transfer",
  "Cash Withdrawal",
  "Bank Transfer",
  "Internal Transfer",
  "Balance Transfer",
  "Investment Transfer",
  "Account-to-Account Transfer",
]);

export type ExpenseFilterable = {
  transaction_type: string;
  primary_category: string | null;
};

/** Header-level check — use whenever transaction_type is available (the reliable case). */
export function isExpenseTransaction(header: ExpenseFilterable): boolean {
  if (NON_EXPENSE_TRANSACTION_TYPES.has(header.transaction_type)) return false;
  if (header.primary_category && NON_EXPENSE_CATEGORIES.has(header.primary_category)) return false;
  return true;
}

/** Category-name-only check — use as a backstop when only a category string is available (no transaction_type in scope). */
export function isExpenseCategory(categoryName: string | null | undefined): boolean {
  if (!categoryName) return true; // uncategorized/null is not a known money-movement label — don't exclude it
  return !NON_EXPENSE_CATEGORIES.has(categoryName);
}
