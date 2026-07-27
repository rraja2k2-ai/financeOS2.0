/**
 * Canonical account type list — single source of truth so the Accounts grouping view,
 * Account Detail, and Settings' Add/Edit Account form never define a 3rd copy. An
 * account_type outside this list won't group correctly on the Accounts screen
 * (services/finance/accounts.service.ts's TYPE_ORDER), so Add/Edit Account validation
 * restricts to exactly these values.
 */
export const ACCOUNT_TYPES = ["Savings", "CreditCard", "Investment", "LoanToOthers"] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Form/detail-display labels — e.g. "Credit Card" instead of the raw "CreditCard" enum value. */
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  Savings: "Savings",
  CreditCard: "Credit Card",
  Investment: "Investment",
  LoanToOthers: "Loan to Others",
};

/** Safe lookup for a plain `string` account_type (e.g. from the DB row) — falls back to
 *  the raw value for anything outside ACCOUNT_TYPES rather than crashing. */
export function accountTypeLabel(accountType: string): string {
  return (ACCOUNT_TYPE_LABELS as Record<string, string>)[accountType] ?? accountType;
}
