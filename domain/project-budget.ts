export type CategoryType = "income" | "expense";

/**
 * Row discriminator — the ONLY signal any repository/service may use to determine what a
 * project_budgets row represents. budget_month must never be compared against a sentinel
 * value to infer row identity (that pattern caused a real collision between two
 * independently-chosen sentinel dates before this discriminator existed — see migration
 * 025's header comment).
 *   - MONTHLY — a real calendar-month budget line. budget_month is meaningful.
 *   - LIFETIME — a named project's non-monthly lifetime budget line (Decision: projects
 *     are lifetime, not monthly). budget_month is a NOT NULL filler value, never read.
 *   - CATEGORY_MASTER — a category identity row (Generic project only, one per
 *     (primary_category, secondary_category) pair, permanent). budget_month is a NOT
 *     NULL filler value, never read.
 */
export type RowType = "MONTHLY" | "LIFETIME" | "CATEGORY_MASTER";

/**
 * The single budget table (post migration 004) — every budget line belongs to a
 * project. Regular monthly categories (Groceries, Dining, ...) live under the
 * Generic project; named projects (Thailand Trip 2026) hold their own lifetime
 * envelopes; Category Master (Decisions 4/5/6) also lives here as category identity
 * rows. All three concerns share one table but are structurally separated by row_type
 * — never by budget_month value. Carry-forward for MONTHLY rows is uniform across
 * projects: the most recent month's rows are cloned into a new month, and unwanted
 * lines are just deleted for that month — there is no separate "recurring" flag.
 */
export type ProjectBudget = {
  id: string;
  project_id: string;
  budget_month: string; // normalized to first-of-month, e.g. "2026-07-01" for MONTHLY rows — meaningless filler for LIFETIME/CATEGORY_MASTER rows
  primary_category: string;
  secondary_category: string | null; // null for whole-category rows with no sub-split
  category_type: CategoryType;
  currency: string;
  budget_amount: string;
  exchange_rate: string;
  budget_amount_sgd: string;
  /** Category Master only — true retires a category: no longer offered in Capture/
   *  Review/Budget's "add category" list, no longer copied into future months. Only
   *  meaningful on a CATEGORY_MASTER row; MONTHLY/LIFETIME rows always carry false. */
  is_archived: boolean;
  row_type: RowType;
  created_at: string;
  updated_at: string;
};
