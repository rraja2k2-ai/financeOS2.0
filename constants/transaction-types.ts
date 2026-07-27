/**
 * Transaction Type Architecture — single source of truth for transaction_headers.
 * transaction_type.
 *
 * Exactly five types are supported; no others. Business scenarios that aren't one of
 * these five (investment, loan, cash withdrawal/deposit, credit card payment, lending,
 * dividend, interest, ...) are modeled AS one of these five — never as a new type:
 *   - an internal move between two of your own accounts, or to/from an external party
 *     (source_account_id/target_account_id, one may be null for an external party,
 *     merchant holds their name) -> TRANSFER
 *   - money leaving an account for a purchase -> EXPENSE
 *   - money entering an account from outside (salary, interest, etc.) -> INCOME
 *   - money returned against a prior Expense -> REFUND
 *   - a balance correction with no counterparty (opening balance, reconciliation) ->
 *     ADJUSTMENT
 *
 * Only EXPENSE is currently produced by the app (Capture always saves "Expense" today —
 * see services/capture/save-capture.service.ts). The other four are architecture-ready
 * (schema constraint, shared constants, filtering) but have no capture/edit UI yet —
 * that is future work, not part of this milestone.
 */

export const TRANSACTION_TYPES = {
  EXPENSE: "EXPENSE",
  INCOME: "INCOME",
  TRANSFER: "TRANSFER",
  REFUND: "REFUND",
  ADJUSTMENT: "ADJUSTMENT",
} as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[keyof typeof TRANSACTION_TYPES];

/** Every allowed value, in the same order as the CHECK constraint (docs/database/migrations). */
export const ALL_TRANSACTION_TYPES: TransactionType[] = Object.values(TRANSACTION_TYPES);

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  EXPENSE: "Expense",
  INCOME: "Income",
  TRANSFER: "Transfer",
  REFUND: "Refund",
  ADJUSTMENT: "Adjustment",
};

/**
 * merchant is reused as-is for all five types (no new column) — only its UI label (and,
 * for Transfer, its visibility) changes per type, finalized by the Transaction Type
 * Finalization milestone:
 *   Expense    -> "Merchant" (required)
 *   Refund     -> "Merchant" (required)
 *   Income     -> "Received From" (optional)
 *   Transfer   -> "External Party" (optional) when the destination is NOT one of the
 *                 user's own accounts (target_account_id null) — the field is hidden
 *                 entirely, and merchant forced empty at save, when the destination
 *                 DOES resolve to a real account (an internal transfer needs no
 *                 counterparty name; see save-capture.service.ts's resolveMerchantForSave()).
 *   Adjustment -> "Reference" (optional) — a short reason for the correction, never a
 *                 counterparty name.
 */
export const MERCHANT_FIELD_LABELS: Record<TransactionType, string> = {
  EXPENSE: "Merchant",
  INCOME: "Received From",
  TRANSFER: "External Party",
  REFUND: "Merchant",
  ADJUSTMENT: "Reference",
};

export function isTransactionType(value: string): value is TransactionType {
  return (ALL_TRANSACTION_TYPES as string[]).includes(value);
}
