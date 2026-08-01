export type Account = {
  id: string;
  account_name: string;
  account_type: string;
  currency: string;
  opening_balance: string;
  current_balance: string;
  status: string;
  notes: string | null;
  /** User-controlled ordering (Master Data & Account Management Refactor, Decision 7) —
   *  null for any row not yet backfilled/reordered; account.repository.ts's list() sorts
   *  nulls last so a never-ordered account simply falls to the end, never errors. */
  display_order: number | null;
  created_at: string;
  updated_at: string;
};
