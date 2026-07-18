export type CategoryType = "income" | "expense";

/**
 * The single budget table (post migration 004) — every budget line belongs to a
 * project. Regular monthly categories (Groceries, Dining, ...) live under the
 * Generic project; named projects (Thailand Trip 2026) hold their own envelopes.
 * Carry-forward is uniform across all projects: the most recent month's rows are
 * cloned into a new month, and unwanted lines are just deleted for that month —
 * there is no separate "recurring" flag.
 */
export type ProjectBudget = {
  id: string;
  project_id: string;
  budget_month: string; // normalized to first-of-month, e.g. "2026-07-01"
  primary_category: string;
  secondary_category: string | null; // null for whole-category rows with no sub-split
  category_type: CategoryType;
  currency: string;
  budget_amount: string;
  exchange_rate: string;
  budget_amount_sgd: string;
  created_at: string;
  updated_at: string;
};
