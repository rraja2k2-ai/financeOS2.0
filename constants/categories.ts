/**
 * Canonical category taxonomy — single source of truth for FinanceOS.
 *
 * This mirrors the 41 categories actually seeded in the `budgets` table (source of
 * truth supplied directly, July 2026) rather than being inferred from a sample of
 * transaction_items — the earlier draft of this file missed several primary
 * categories entirely (Insurance, Leisure & Entertainment, all Income categories)
 * and had a few wrong subcategory names. Categories only budgets can plan against
 * should come from here so budget reconciliation (TAD-003 §11.5) always matches.
 *
 * Reconciled in docs/database/migrations/002_reconcile_categorization_rules.sql.
 * Phase 2 Classification (services/ai/phase2.classify.ts) must only emit
 * primary/secondary pairs from this list.
 *
 * Note: "Housing" and "Housing & Utilities" are both real, distinct primary
 * categories here (House Rent sits under "Housing"; Utilities/Internet & Mobile/
 * Home Maintenance sit under "Housing & Utilities") — an earlier audit pass
 * incorrectly flagged this as a data-quality bug to normalize. It isn't; leave
 * both as-is.
 *
 * Open question (not resolved here): transaction_headers.transaction_type is
 * Expense | Payment | Transfer | Lending (TAD-003 §11.2) with no "Income" value,
 * yet this taxonomy has a whole Income side (Salary, Interest Income, Rental
 * Income, Cashback & Rewards). Needs a decision before Phase 1/2 can classify an
 * incoming salary deposit — either transaction_type gains an "Income" value, or
 * income events are logged as Payment/Transfer and categorized separately.
 */

export type CategoryType = "income" | "expense";

export type CategoryTaxonomyEntry = {
  primary: string;
  categoryType: CategoryType;
  subcategories: string[];
};

export const CATEGORY_TAXONOMY: CategoryTaxonomyEntry[] = [
  // --- Income ---
  { primary: "Cashback & Rewards", categoryType: "income", subcategories: ["Cashback"] },
  { primary: "Interest Income", categoryType: "income", subcategories: ["Bank Interest"] },
  { primary: "Investments", categoryType: "income", subcategories: ["Stock Dividends"] },
  { primary: "Rental Income", categoryType: "income", subcategories: ["Property Rent"] },
  { primary: "Salary", categoryType: "income", subcategories: ["Bonus", "Regular Salary"] },

  // --- Expense ---
  { primary: "Education", categoryType: "expense", subcategories: ["Books & Stationery", "School Fees", "Tuition"] },
  { primary: "Family Support", categoryType: "expense", subcategories: ["Gifts & Festivals", "Allowances"] },
  { primary: "Food & Dining", categoryType: "expense", subcategories: ["Dining Out"] },
  {
    primary: "Groceries",
    categoryType: "expense",
    subcategories: ["Dairy & Eggs", "Fruits", "Grains & Staples", "Meat & Seafood", "Snacks & Beverages", "Vegetables"],
  },
  { primary: "Healthcare", categoryType: "expense", subcategories: ["Medical Expenses", "Medicines"] },
  { primary: "Housing", categoryType: "expense", subcategories: ["House Rent"] },
  { primary: "Housing & Utilities", categoryType: "expense", subcategories: ["Home Maintenance", "Internet & Mobile", "Utilities"] },
  {
    primary: "Insurance",
    categoryType: "expense",
    subcategories: [
      "Critical Illness Insurance",
      "Health Insurance",
      "Life Insurance",
      "Personal Accident Insurance",
      "Term Insurance",
    ],
  },
  {
    primary: "Investments",
    categoryType: "expense",
    subcategories: ["Global Stocks (US/HK)", "Gold Investments", "Indian Stocks / SIP"],
  },
  { primary: "Leisure & Entertainment", categoryType: "expense", subcategories: ["Entertainment", "Subscriptions", "Travel"] },
  { primary: "Lending", categoryType: "expense", subcategories: ["Loans to Others"] },
  { primary: "Miscellaneous", categoryType: "expense", subcategories: ["Miscellaneous"] },
  { primary: "Shopping", categoryType: "expense", subcategories: ["Clothing & Apparel", "Gadgets & Electronics"] },
  { primary: "Transportation", categoryType: "expense", subcategories: ["Public Transport", "Taxi & Ride Hailing"] },
];

export const PRIMARY_CATEGORIES: readonly string[] = Array.from(new Set(CATEGORY_TAXONOMY.map((c) => c.primary)));

/** "Investments" is both an income (dividends) and expense (buying in) primary category — pass categoryType to disambiguate. */
export function subcategoriesFor(primaryCategory: string, categoryType?: CategoryType): string[] {
  const entries = CATEGORY_TAXONOMY.filter(
    (c) => c.primary === primaryCategory && (categoryType ? c.categoryType === categoryType : true)
  );
  return entries.flatMap((e) => e.subcategories);
}

export function isKnownCategory(primaryCategory: string, secondaryCategory?: string): boolean {
  const entries = CATEGORY_TAXONOMY.filter((c) => c.primary === primaryCategory);
  if (entries.length === 0) return false;
  if (!secondaryCategory) return true;
  return entries.some((e) => e.subcategories.includes(secondaryCategory));
}
