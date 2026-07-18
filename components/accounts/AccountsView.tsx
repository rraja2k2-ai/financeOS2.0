"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { GroupedAccounts } from "@/services/finance/accounts.service";

export type AccountsViewProps = {
  data: GroupedAccounts;
};

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const TYPE_ICON: Record<string, string> = {
  Savings: "🏦",
  CreditCard: "💳",
  Investment: "📈",
  LoanToOthers: "🤝",
};

export function AccountsView({ data }: AccountsViewProps) {
  const [hidden, setHidden] = useState(false);

  return (
    <div className="px-5 pt-6 pb-8">
      <div className="mb-5 flex items-start justify-between">
        <h1 className="text-[22px] font-bold tracking-tight">Accounts</h1>
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

      <div className="mb-6">
        <p className="text-[12.5px] font-semibold text-muted-foreground">Net worth</p>
        <p className={cn("mt-1 font-mono text-[28px] font-semibold tabular-nums", hidden && "blur-md select-none")}>
          <span className="mr-1.5 font-sans text-[14px] font-semibold text-muted-foreground">SGD</span>
          {fmt(data.netWorthSgd)}
        </p>
        {data.unconvertedCurrencies.length > 0 && (
          <p className="mt-1 text-[11px] text-amber">
            Excludes {data.unconvertedCurrencies.join(", ")} — no exchange rate on file yet.
          </p>
        )}
      </div>

      {data.groups.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
          No active accounts.
        </div>
      ) : (
        data.groups.map((group) => (
          <section key={group.key} className="mb-6">
            <div className="mb-2.5 flex items-baseline justify-between border-b-2 border-border pb-2">
              <p className="text-[15px] font-bold tracking-tight">{group.label}</p>
              <p className={cn("font-mono text-[13.5px] font-semibold tabular-nums text-muted-foreground", hidden && "blur-sm select-none")}>
                {group.totalSgd !== null ? `SGD ${fmt(group.totalSgd)}` : "—"}
              </p>
            </div>

            {group.typeGroups.map((tg) => (
              <div key={tg.label} className="mb-3.5">
                <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{tg.label}</p>
                {tg.accounts.map((acc) => (
                  <div key={acc.id} className="mb-1.5 flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-card p-3">
                    <div
                      className={cn(
                        "flex h-9 w-9 flex-none items-center justify-center rounded-lg text-[15px]",
                        acc.accountType === "CreditCard" ? "bg-destructive/15" : acc.accountType === "Investment" ? "bg-accent" : acc.accountType === "LoanToOthers" ? "bg-amber-soft" : "bg-secondary"
                      )}
                    >
                      {TYPE_ICON[acc.accountType] ?? "💰"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold">{acc.accountName}</p>
                      <p className="text-[11.5px] text-muted-foreground">
                        {acc.accountType === "LoanToOthers" ? "Loan to others · not held cash" : acc.accountType}
                      </p>
                    </div>
                    <div className={cn("flex-none text-right", hidden && "blur-sm select-none")}>
                      <div
                        className={cn(
                          "font-mono text-[13.5px] font-semibold tabular-nums",
                          acc.nativeBalance < 0 && "text-destructive"
                        )}
                      >
                        {fmt(acc.nativeBalance)}
                      </div>
                      {acc.currency !== "SGD" && (
                        <div className="font-mono text-[10.5px] text-muted-foreground tabular-nums">
                          {acc.sgdBalance !== null ? `≈ SGD ${fmt(acc.sgdBalance)}` : "no rate"}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
