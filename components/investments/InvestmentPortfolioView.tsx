import Link from "next/link";
import { cn } from "@/lib/utils";
import type { InvestmentPortfolioSummary } from "@/services/finance/investment-portfolio.service";
import { InvestmentKpiGrid } from "@/components/investments/InvestmentKpiGrid";

function fmt(n: number, decimals = 0) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function signedSgd(n: number): string {
  return `${n < 0 ? "−" : ""}SGD ${fmt(Math.abs(n))}`;
}

/**
 * Investment Portfolio (Version 1) — analytical view only, reachable from Settings.
 * Account creation/edit/archive/delete stays exclusively under Settings → Accounts; this
 * screen has no create/edit affordance of its own. Every number comes from
 * investment-portfolio.service.ts (already computed server-side in app/invest/page.tsx) —
 * this component only formats and lays out, never calculates.
 */
export function InvestmentPortfolioView({ summary }: { summary: InvestmentPortfolioSummary }) {
  return (
    <div className="px-5 pt-6 pb-8">
      <h1 className="mb-5 text-[22px] font-bold tracking-tight">Investment Portfolio</h1>

      <section className="mb-6">
        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Portfolio summary</p>
        <InvestmentKpiGrid metrics={summary.total} variant="summary" />
      </section>

      <section>
        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Investment accounts</p>

        {summary.accounts.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
            No investment accounts yet.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {summary.accounts.map((m) => (
              <Link
                key={m.account.id}
                href={`/accounts/${m.account.id}`}
                className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-card p-3"
              >
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-secondary text-[15px]">📈</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold">{m.account.account_name}</p>
                  <p className="text-[11.5px] text-muted-foreground">{m.account.currency}</p>
                </div>
                <div className="flex-none text-right">
                  <p className="font-mono text-[13.5px] font-bold tabular-nums">
                    {m.currentMarketValueSgd === null ? "—" : `SGD ${fmt(m.currentMarketValueSgd)}`}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 font-mono text-[10.5px] tabular-nums",
                      m.portfolioGainLossSgd !== null && m.portfolioGainLossSgd < 0 ? "text-destructive" : "text-muted-foreground"
                    )}
                  >
                    {m.portfolioGainLossSgd === null ? "—" : signedSgd(m.portfolioGainLossSgd)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
