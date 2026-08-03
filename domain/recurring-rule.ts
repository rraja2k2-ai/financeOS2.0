export type RecurringInterval = "WEEK" | "MONTH" | "YEAR";
export type RecurringEndMode = "NEVER" | "ON_DATE" | "AFTER_COUNT";

/**
 * A recurring rule is a living template, not historical data — editing it only changes
 * future generated transactions (Recurring Transactions feature). Generated transactions
 * are ordinary, independent transaction_headers rows; nothing links back to this row, so
 * next_due_date is the sole progress cursor (see repositories/recurring-rule.repository.ts).
 */
export type RecurringRule = {
  id: string;
  transaction_type: string;
  merchant: string;
  amount: string;
  currency: string;
  primary_category: string;
  secondary_category: string | null;
  source_account_id: string | null;
  target_account_id: string | null;
  project_id: string | null;
  comments: string | null;
  interval_count: number;
  interval_unit: RecurringInterval;
  start_date: string;
  next_due_date: string;
  /** Stored for edit-form redisplay only — generation never branches on it, it just
   *  compares next_due_date against end_value. When the user picks "After N Occurrences",
   *  N is converted to a concrete end_value date immediately (services/finance/
   *  recurring-rule.service.ts) rather than persisted as a separate count. */
  end_mode: RecurringEndMode;
  end_value: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
