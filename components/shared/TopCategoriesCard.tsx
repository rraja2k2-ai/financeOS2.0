"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { CategorySpend } from "@/services/finance/category-spend.service";

export type TopCategoriesCardProps = {
  categories: CategorySpend[];
  periodLabel: string;
  hidden?: boolean;
  /** When provided, subcategory rows and a "View all" link (both only visible once a
   *  category is expanded) become clickable and call this instead of doing nothing —
   *  e.g. Activity's own Top Categories card navigating to itself pre-filtered
   *  (UX Polish: Activity Top Categories Drill-down). The category row's own click
   *  still only expands/collapses, unchanged, exactly like Dashboard's equivalent.
   *  Omit to keep the original read-only expand behavior. */
  onDrilldown?: (filter: { primaryCategory: string; secondaryCategory?: string }) => void;
};

function fmt(n: number, decimals = 0) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const TOP_N = 7;

/**
 * Collapsible primary-category -> subcategory spend breakdown, top 7 by spend only
 * (no "view all" yet — remaining categories are simply not shown). Uses the CSS
 * grid-template-rows 0fr/1fr transition trick for a genuinely smooth expand/collapse
 * animation without measuring content height in JS.
 */
export function TopCategoriesCard({ categories: allCategories, periodLabel, hidden, onDrilldown }: TopCategoriesCardProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  // Section-level collapse (Activity Page UX Improvement) — separate from `expanded`
  // above, which tracks which single category's subcategories are open. Defaults
  // expanded every render; not persisted anywhere (no localStorage, per scope).
  const [sectionOpen, setSectionOpen] = useState(true);
  // Input is already sorted descending by the source services, but re-sort defensively
  // rather than assume — this component's contract is "top N by spend", not "however
  // the caller ordered them."
  const categories = [...allCategories].sort((a, b) => b.sgdAmount - a.sgdAmount).slice(0, TOP_N);
  const maxAmount = categories[0]?.sgdAmount ?? 1;

  return (
    <section className="mb-4">
      <button
        type="button"
        onClick={() => setSectionOpen((o) => !o)}
        aria-expanded={sectionOpen}
        className="mb-2.5 flex w-full items-baseline justify-between text-left"
      >
        <span className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn("flex-none transition-transform duration-300", sectionOpen && "rotate-90")}
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
          Top categories
        </span>
        <span className="text-[11.5px] font-normal normal-case tracking-normal text-muted-foreground">{periodLabel}</span>
      </button>

      <div className="grid transition-[grid-template-rows] duration-300 ease-in-out" style={{ gridTemplateRows: sectionOpen ? "1fr" : "0fr" }}>
        <div className="overflow-hidden">
          {categories.length === 0 ? (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
              No spend in this period.
            </div>
          ) : (
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
              {categories.map((cat, i) => {
                const isOpen = expanded === cat.primaryCategory;
                return (
                  <div key={cat.primaryCategory} className={cn("p-3.5", i > 0 && "border-t border-border")}>
                    <button
                      className="flex w-full items-baseline justify-between text-left"
                      onClick={() => setExpanded(isOpen ? null : cat.primaryCategory)}
                      aria-expanded={isOpen}
                    >
                      <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
                        {cat.primaryCategory}
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={cn("text-muted-foreground transition-transform duration-300", isOpen && "rotate-180")}
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </span>
                      <span className={cn("font-mono text-[13px] font-semibold tabular-nums text-muted-foreground", hidden && "blur-sm select-none")}>
                        SGD {fmt(cat.sgdAmount)}
                      </span>
                    </button>
                    <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (cat.sgdAmount / maxAmount) * 100)}%` }} />
                    </div>

                    <div
                      className="grid transition-[grid-template-rows] duration-300 ease-in-out"
                      style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                    >
                      <div className="overflow-hidden">
                        <div className="mt-2.5 space-y-1.5">
                          {cat.subcategories.map((sub) => (
                            <button
                              key={sub.name}
                              type="button"
                              onClick={() => onDrilldown?.({ primaryCategory: cat.primaryCategory, secondaryCategory: sub.name })}
                              className="flex w-full justify-between border-l-2 border-border py-1 pl-3.5 text-left text-[12px] text-muted-foreground"
                            >
                              <span>{sub.name}</span>
                              <span className={cn("font-mono font-semibold tabular-nums text-foreground", hidden && "blur-sm select-none")}>
                                {fmt(sub.sgdAmount)}
                              </span>
                            </button>
                          ))}
                        </div>
                        {onDrilldown && (
                          <button
                            type="button"
                            onClick={() => onDrilldown({ primaryCategory: cat.primaryCategory })}
                            className="block pt-1.5 pl-3.5 text-left text-[11.5px] font-semibold text-primary"
                          >
                            View all {cat.primaryCategory} →
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
