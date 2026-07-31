/**
 * Dashboard v1.4 (Decision Dashboard) — server-side computations for the Snapshot and
 * Attention sections. Pure aggregation over data other services already compute or a
 * single lightweight query reusing an existing repository method; no new heuristics, no
 * AI, no new database tables. Every classifier reused here (isExpenseTransaction via
 * category-spend.service's totals, categoryTypeFor) is the SAME one the rest of the app
 * already relies on (account-detail.service.ts's own Income/Expenses summary uses the
 * identical categoryTypeFor pattern) — nothing new is invented.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as transactionHeaderRepository from "@/repositories/transaction-header.repository";
import { categoryTypeFor } from "@/constants/categories";
import { categoryActivityHref } from "@/lib/period";
import type { CategorySpend } from "./category-spend.service";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** This month's total income (categoryTypeFor === "income", the same classifier
 *  account-detail.service.ts's per-account Income/Expenses/Net Change summary already
 *  uses). One new headers-only query — Expense total is deliberately NOT recomputed
 *  here; callers already have it from category-spend.service's categorySpend rollup. */
export async function getMonthlyIncomeSgd(supabase: SupabaseClient, startDate: string, endDate: string): Promise<number> {
  const headers = await transactionHeaderRepository.listByDateRange(supabase, startDate, endDate);
  let income = 0;
  for (const header of headers) {
    if (categoryTypeFor(header.primary_category) === "income") {
      income += Number(header.sgd_total_amount);
    }
  }
  return round2(income);
}

export type BudgetPace = {
  dayOfMonth: number;
  daysInMonth: number;
  expectedPct: number;
  actualPct: number;
  comparison: "below" | "above" | "on";
};

/** Budget Pace — "Day 15 of 30, expected 50%, actual 42%." Pure date/percentage math,
 *  mathematically verifiable, nothing fuzzy: expectedPct assumes even spend across the
 *  month (dayOfMonth / daysInMonth); actualPct reuses the exact spentSgd/budgetedSgd the
 *  existing budget ring already shows, just uncapped (the ring caps display at 100% for
 *  its own visual; pace should always show the true number, even past 100%). */
export function computeBudgetPace(spentSgd: number, budgetedSgd: number, today: Date, monthStart: string, monthEnd: string): BudgetPace | null {
  if (budgetedSgd <= 0) return null;
  const start = new Date(`${monthStart}T00:00:00Z`);
  const end = new Date(`${monthEnd}T00:00:00Z`);
  const daysInMonth = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const elapsedDays = Math.floor((today.getTime() - start.getTime()) / 86_400_000) + 1;
  const dayOfMonth = Math.min(Math.max(elapsedDays, 1), daysInMonth);
  const expectedPct = Math.round((dayOfMonth / daysInMonth) * 100);
  const actualPct = Math.round((spentSgd / budgetedSgd) * 100);
  const comparison = actualPct > expectedPct ? "above" : actualPct < expectedPct ? "below" : "on";
  return { dayOfMonth, daysInMonth, expectedPct, actualPct, comparison };
}

export type AttentionItem = {
  id: string;
  message: string;
  href: string;
};

/** A budget-pace gap at or above this many percentage points is "significant" enough to
 *  surface as attention, rather than every day the pace is even slightly off a straight
 *  line — a fixed, documented threshold, not a heuristic or AI judgment call. */
const PACE_ATTENTION_THRESHOLD_POINTS = 15;

/** Attention items — every one sourced from a signal another part of the app already
 *  computes: Capture Inbox status (failed captures), net-cash's own unconverted-currency
 *  detection, and budget pace + category-spend's own highest contributor (already sorted
 *  descending). No AI, no invented signal. Empty when nothing needs attention — callers
 *  must hide the section entirely in that case, never render an empty-state message. */
export function buildAttentionItems(input: {
  failedCaptureCount: number;
  unconvertedCurrencies: string[];
  budgetPace: BudgetPace | null;
  topCategory: CategorySpend | null;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (input.failedCaptureCount > 0) {
    const n = input.failedCaptureCount;
    items.push({
      id: "failed-captures",
      message: `${n} capture${n === 1 ? "" : "s"} failed to process and need${n === 1 ? "s" : ""} your attention.`,
      href: "/inbox",
    });
  }

  if (input.unconvertedCurrencies.length > 0) {
    items.push({
      id: "missing-exchange-rate",
      message: `No exchange rate on file for ${input.unconvertedCurrencies.join(", ")} — some totals may be incomplete.`,
      href: "/settings/exchange-rates",
    });
  }

  if (
    input.budgetPace &&
    input.budgetPace.comparison === "above" &&
    input.budgetPace.actualPct - input.budgetPace.expectedPct >= PACE_ATTENTION_THRESHOLD_POINTS &&
    input.topCategory
  ) {
    const { dayOfMonth, daysInMonth, expectedPct, actualPct } = input.budgetPace;
    items.push({
      id: "budget-ahead-of-pace",
      message: `You've used ${actualPct}% of this month's budget by day ${dayOfMonth} of ${daysInMonth} (${expectedPct}% would be on pace) — ${input.topCategory.primaryCategory} is the largest contributor.`,
      href: categoryActivityHref({ primaryCategory: input.topCategory.primaryCategory, period: "this-month" }),
    });
  }

  return items;
}
