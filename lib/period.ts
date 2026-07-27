/**
 * Shared period/date-range logic for screens with a "This month / Last 3 / Last 6 /
 * Custom" selector (Activity, Budget). Pure functions — no React — so the same date
 * math is used everywhere instead of being reimplemented per screen.
 */

export type PeriodKey = "this-month" | "last-month" | "last3" | "last6" | "this-year" | "custom";

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "last3", label: "Last 3 months" },
  { key: "last6", label: "Last 6 months" },
  { key: "this-year", label: "This year" },
  { key: "custom", label: "Custom date" },
];

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function startOfMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const PERIOD_DAYS: Record<"last3" | "last6", number> = {
  last3: 92,
  last6: 183,
};

export type DateRange = { start: string; end: string };

/**
 * Resolves a period selection to a concrete [start, end] range. For "custom", the
 * caller-provided dates are used as-is (falling back to this-month bounds if either
 * is missing, e.g. before the user has picked both).
 */
export function resolvePeriodRange(period: PeriodKey, customStart?: string, customEnd?: string): DateRange {
  if (period === "custom") {
    return {
      start: customStart || startOfMonthIso(),
      end: customEnd || todayIso(),
    };
  }
  if (period === "this-month") {
    return { start: startOfMonthIso(), end: todayIso() };
  }
  if (period === "last-month") {
    return monthBounds(shiftMonth(startOfMonthIso(), -1));
  }
  if (period === "this-year") {
    const now = new Date();
    return { start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10), end: todayIso() };
  }
  return { start: daysAgoIso(PERIOD_DAYS[period]), end: todayIso() };
}

/** First and last calendar day of the month containing `monthStart` (a first-of-month ISO date). */
export function monthBounds(monthStart: string): DateRange {
  const [y, m] = monthStart.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end };
}

/** `monthStart` shifted by `delta` whole months, still first-of-month. */
export function shiftMonth(monthStart: string, delta: number): string {
  const [y, m] = monthStart.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
}

export function monthLabel(monthStart: string): string {
  return new Date(monthStart + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Builds an Activity URL pre-filtered by category (and optionally subcategory), with a
 * period carried through — the one place this URL is constructed, shared by Dashboard's
 * Top Categories drill-down and Activity's own Top Categories card (UX Polish: Activity
 * Top Categories Drill-down), so both produce byte-identical links instead of each
 * re-implementing the query string.
 */
export function categoryActivityHref(params: {
  primaryCategory: string;
  secondaryCategory?: string;
  period: PeriodKey;
  customStart?: string;
  customEnd?: string;
}): string {
  const search = new URLSearchParams();
  search.set("category", params.primaryCategory);
  if (params.secondaryCategory) search.set("subcategory", params.secondaryCategory);
  search.set("period", params.period);
  if (params.period === "custom") {
    if (params.customStart) search.set("from", params.customStart);
    if (params.customEnd) search.set("to", params.customEnd);
  }
  return `/activity?${search.toString()}`;
}
