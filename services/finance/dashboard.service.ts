/**
 * Dashboard v1.4 (Decision Dashboard) — server-side computations for the Snapshot and
 * Attention sections. Pure aggregation over data other services already compute or a
 * single lightweight query reusing an existing repository method; no new heuristics, no
 * AI, no new database tables. Every classifier reused here (isExpenseTransaction,
 * categoryTypeFor) is the SAME one the rest of the app already relies on
 * (account-detail.service.ts's own Income/Expenses summary uses the identical pattern —
 * this file's getMonthlyIncomeAndExpense mirrors it exactly, just household-wide instead
 * of per-account) — nothing new is invented.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as transactionHeaderRepository from "@/repositories/transaction-header.repository";
import { isExpenseTransaction } from "@/lib/expense-filter";
import { categoryTypeFor } from "@/constants/categories";
import { categoryActivityHref } from "@/lib/period";
import type { CategorySpend } from "./category-spend.service";

/** The one shared rounding helper for this file (and its one caller, app/page.tsx —
 *  imported from here rather than each defining its own copy). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type MonthlyIncomeAndExpense = {
  incomeSgd: number;
  expenseSgd: number;
};

/**
 * This month's total income and expense, computed together from ONE headers-only query
 * (mirrors account-detail.service.ts's getAccountPeriodSummary exactly, household-wide
 * instead of one account) — fixes the Dashboard v1.4 review finding that Income and
 * Expense were each fetching the same month's transaction_headers independently
 * (Expense via category-spend.service's item-level rollup, Income via its own separate
 * listByDateRange call). This is now the ONLY place Dashboard fetches headers for these
 * two totals; category-spend.service's own listByDateRange (needed separately for the
 * Attention section's per-category breakdown, which requires item-level data this
 * headers-only query intentionally does not fetch) is unrelated call, not a leftover
 * duplicate of this one.
 *
 * Graceful degradation (Dashboard v1.4 review, Fix 4): a transient query failure here
 * logs and returns zeros rather than throwing — same philosophy net-cash.service.ts
 * already applies to a missing exchange rate ("shouldn't 500 the whole Dashboard").
 */
export async function getMonthlyIncomeAndExpense(supabase: SupabaseClient, startDate: string, endDate: string): Promise<MonthlyIncomeAndExpense> {
  try {
    const headers = await transactionHeaderRepository.listByDateRange(supabase, startDate, endDate);
    let income = 0;
    let expense = 0;
    for (const header of headers) {
      const amount = Number(header.sgd_total_amount);
      if (isExpenseTransaction(header)) {
        expense += amount;
      } else if (categoryTypeFor(header.primary_category) === "income") {
        income += amount;
      }
    }
    return { incomeSgd: round2(income), expenseSgd: round2(expense) };
  } catch (err) {
    console.error("[dashboard] monthly income/expense query failed:", err);
    return { incomeSgd: 0, expenseSgd: 0 };
  }
}

/** Budget Remaining (Dashboard v1.4 review, Fix 3) — moved out of DashboardView so the
 *  view stays presentation-only; never negative (an over-budget month has nothing left
 *  to show as "remaining", the Pace section already communicates being over). */
export function computeBudgetRemainingSgd(budgetedSgd: number, spentSgd: number): number {
  return Math.max(0, round2(budgetedSgd - spentSgd));
}

export type BudgetPace = {
  dayOfMonth: number;
  daysInMonth: number;
  expectedPct: number;
  actualPct: number;
  comparison: "below" | "above" | "on";
};

/** FinanceOS is a single-user, Singapore-based app (CLAUDE.md) — Budget Pace's "day of
 *  month" must reflect the user's own calendar day, not the server's UTC clock. Fixed
 *  here rather than made configurable (no second user to configure it for). */
const DASHBOARD_TIMEZONE = "Asia/Singapore";

/** "YYYY-MM-DD" for `date` in `timeZone` — no timezone library, just the Intl API
 *  already built into Node/the browser. */
function localCalendarDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Day-of-month from calendar-date STRING comparison only — never a millisecond
 *  difference against a UTC midnight boundary (that was the Dashboard v1.4 review's
 *  Fix 1 finding: mixing a time-of-day-bearing `today` against a UTC boundary produced
 *  an off-by-one for hours around every local midnight for a UTC+8 user). Clamped to
 *  the month's own range if `today` and `monthStart` ever disagree on which month it is
 *  (e.g. a stale render right at a month boundary) rather than producing a negative or
 *  out-of-range day. */
function dayOfMonthFor(todayLocalIso: string, monthStartIso: string, daysInMonth: number): number {
  const todayMonthKey = todayLocalIso.slice(0, 7);
  const startMonthKey = monthStartIso.slice(0, 7);
  if (todayMonthKey < startMonthKey) return 1;
  if (todayMonthKey > startMonthKey) return daysInMonth;
  const day = Number(todayLocalIso.slice(8, 10));
  return Math.min(Math.max(day, 1), daysInMonth);
}

/** Budget Pace — "Day 15 of 30, expected 50%, actual 42%." Pure date/percentage math,
 *  mathematically verifiable, nothing fuzzy: expectedPct assumes even spend across the
 *  month (dayOfMonth / daysInMonth); actualPct reuses the exact spentSgd/budgetedSgd the
 *  existing budget ring already shows, just uncapped (the ring caps display at 100% for
 *  its own visual; pace should always show the true number, even past 100%). daysInMonth
 *  is pure calendar-string arithmetic (both monthStart/monthEnd are UTC-midnight of a
 *  calendar date, no "now" involved, so this part was never timezone-sensitive); only
 *  dayOfMonth depends on "what is today", which now goes through dayOfMonthFor() above. */
export function computeBudgetPace(spentSgd: number, budgetedSgd: number, today: Date, monthStart: string, monthEnd: string): BudgetPace | null {
  if (budgetedSgd <= 0) return null;
  const start = new Date(`${monthStart}T00:00:00Z`);
  const end = new Date(`${monthEnd}T00:00:00Z`);
  const daysInMonth = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const todayLocal = localCalendarDate(today, DASHBOARD_TIMEZONE);
  const dayOfMonth = dayOfMonthFor(todayLocal, monthStart, daysInMonth);
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
