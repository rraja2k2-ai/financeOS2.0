"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { NetCashPosition } from "@/services/finance/net-cash.service";
import type { CategorySpend } from "@/services/finance/category-spend.service";
import type { RecentTransaction } from "@/services/finance/activity.service";

export type DashboardViewProps = {
  monthLabel: string;
  netCash: NetCashPosition;
  categorySpend: CategorySpend[];
  budget: {
    budgetedSgd: number;
    spentSgd: number;
    isCarriedForward: boolean;
    sourceMonth: string | null;
  } | null;
  recentTransactions: RecentTransaction[];
};

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function DashboardView({ monthLabel, netCash, categorySpend, budget, recentTransactions }: DashboardViewProps) {
  const [hidden, setHidden] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const maxCategorySgd = categorySpend[0]?.sgdAmount ?? 1;
  const pct = budget && budget.budgetedSgd > 0 ? Math.min(100, Math.round((budget.spentSgd / budget.budgetedSgd) * 100)) : null;

  return (
    <div className="px-5 pt-6">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{today()}</p>
          <h1 className="text-[22px] font-bold tracking-tight">Good day, Raja</h1>
        </div>
        <button
          onClick={() => setHidden((h) => !h)}
          aria-pressed={hidden}
          aria-label="Hide amounts"
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground",
            hidden && "border-primary text-primary"
          )}
        >
          {hidden ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.6 18.6 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19" />
              <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24M1 1l22 22" />
            </svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>

      {/* Today's Pulse */}
      <section className="mb-6">
        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Today&apos;s pulse</p>

        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-[18px]">
          <p className="text-[12.5px] font-semibold text-muted-foreground">Net cash position</p>
          <p className={cn("mt-1.5 font-mono text-[34px] font-semibold tracking-tight tabular-nums", hidden && "blur-md select-none")}>
            <span className="mr-1.5 font-sans text-[16px] font-semibold text-muted-foreground">SGD</span>
            {fmt(netCash.sgdTotal)}
          </p>
          {netCash.unconvertedCurrencies.length > 0 && (
            <p className="mt-1 text-[11px] text-amber">
              Excludes {netCash.unconvertedCurrencies.join(", ")} — no exchange rate on file yet.
            </p>
          )}

          <div className={cn("mt-4 flex gap-2 overflow-x-auto", hidden && "blur-sm select-none")}>
            {netCash.byCurrency.map((c) => (
              <div key={c.currency} className="flex flex-none items-baseline gap-1.5 whitespace-nowrap rounded-full bg-secondary px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground">
                {c.currency}
                <b className="font-mono tabular-nums font-semibold text-foreground">{fmt(c.nativeAmount)}</b>
              </div>
            ))}
            {netCash.loansOut.map((l) => (
              <div key={`loan-${l.currency}`} className="flex flex-none items-baseline gap-1.5 whitespace-nowrap rounded-full bg-amber-soft px-3 py-1.5 text-[12.5px] font-semibold text-amber">
                Lent out
                <b className="font-mono tabular-nums font-semibold">{l.currency} {fmt(l.nativeAmount)}</b>
              </div>
            ))}
          </div>
        </div>

        {budget && (
          <div className="mt-2.5 rounded-[var(--radius-md)] border border-border bg-card p-3.5">
            <div className="flex items-center gap-3">
              <RingChart pct={pct ?? 0} />
              <div>
                <p className={cn("font-mono text-[18px] font-semibold tabular-nums", hidden && "blur-sm select-none")}>{pct ?? "—"}%</p>
                <p className={cn("text-[11.5px] text-muted-foreground", hidden && "blur-sm select-none")}>
                  SGD {fmt(budget.spentSgd, 0)} / {fmt(budget.budgetedSgd, 0)} this month
                </p>
              </div>
            </div>
            {budget.isCarriedForward && (
              <p className="mt-2 text-[11px] text-amber">
                Showing {budget.sourceMonth}&apos;s budget — {monthLabel} hasn&apos;t been started yet.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Top Categories */}
      <section className="mb-6">
        <div className="mb-2.5 flex items-baseline justify-between">
          <p className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Top categories · {monthLabel}</p>
        </div>

        {categorySpend.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
            No transactions yet in {monthLabel}.
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
            {categorySpend.slice(0, 7).map((cat, i) => {
              const isOpen = expandedCategory === cat.primaryCategory;
              return (
                <div key={cat.primaryCategory} className={cn("p-3.5", i > 0 && "border-t border-border")}>
                  <button
                    className="flex w-full items-baseline justify-between text-left"
                    onClick={() => setExpandedCategory(isOpen ? null : cat.primaryCategory)}
                    aria-expanded={isOpen}
                  >
                    <span className="text-[13.5px] font-semibold">{cat.primaryCategory}</span>
                    <span className={cn("font-mono text-[13px] font-semibold tabular-nums text-muted-foreground", hidden && "blur-sm select-none")}>
                      SGD {fmt(cat.sgdAmount, 0)}
                    </span>
                  </button>
                  <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (cat.sgdAmount / maxCategorySgd) * 100)}%` }} />
                  </div>
                  {isOpen && (
                    <div className="mt-2.5 space-y-1.5">
                      {cat.subcategories.map((sub) => (
                        <div key={sub.name} className="flex justify-between border-l-2 border-border py-1 pl-3.5 text-[12px] text-muted-foreground">
                          <span>{sub.name}</span>
                          <span className={cn("font-mono font-semibold tabular-nums text-foreground", hidden && "blur-sm select-none")}>
                            {fmt(sub.sgdAmount, 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent Transactions */}
      <section className="mb-6">
        <div className="mb-2.5 flex items-baseline justify-between">
          <p className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Recent transactions</p>
          <Link href="/activity" className="text-[12.5px] font-semibold text-primary">
            See all
          </Link>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
            No transactions yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
            {recentTransactions.map((t, i) => (
              <Link
                key={t.id}
                href={`/activity?highlight=${t.id}`}
                className={cn("flex items-center gap-3 p-3.5", i > 0 && "border-t border-border")}
              >
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-secondary text-[15px]">🧾</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold">{t.merchant || "Unknown merchant"}</p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {t.primaryCategory || "Uncategorized"} · {formatShortDate(t.transactionDate)}
                  </p>
                </div>
                <div className={cn("flex-none text-right", hidden && "blur-sm select-none")}>
                  {t.currencyGroup === "INR" ? (
                    <>
                      <div className="font-mono text-[13px] font-semibold tabular-nums">₹{fmt(t.originalAmount)}</div>
                      <div className="font-mono text-[10.5px] text-muted-foreground tabular-nums">≈ SGD {fmt(t.sgdAmount)}</div>
                    </>
                  ) : t.currency === "SGD" ? (
                    <div className="font-mono text-[13px] font-semibold tabular-nums">SGD {fmt(t.originalAmount)}</div>
                  ) : (
                    <>
                      <div className="font-mono text-[13px] font-semibold tabular-nums">SGD {fmt(t.sgdAmount)}</div>
                      <div className="font-mono text-[10.5px] text-muted-foreground tabular-nums">{t.currency} {fmt(t.originalAmount)}</div>
                    </>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <p className="mb-4 rounded-[var(--radius-md)] border border-dashed border-border p-3.5 text-center text-[11.5px] leading-relaxed text-muted-foreground">
        &quot;Needs You&quot; and &quot;The Story&quot; aren&apos;t shown yet — Needs You is genuinely empty (no pending
        captures), and Story insights need month-over-month data this partial month doesn&apos;t have yet.
      </p>
    </div>
  );
}

function formatShortDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

function RingChart({ pct }: { pct: number }) {
  const r = 19;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pct / 100);
  const color = pct >= 100 ? "var(--destructive)" : pct >= 80 ? "var(--amber)" : "var(--primary)";

  return (
    <svg width="46" height="46" viewBox="0 0 46 46" className="flex-none">
      <circle cx="23" cy="23" r={r} fill="none" stroke="var(--secondary)" strokeWidth="5" />
      <circle
        cx="23"
        cy="23"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 23 23)"
      />
    </svg>
  );
}

function today(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" });
}
