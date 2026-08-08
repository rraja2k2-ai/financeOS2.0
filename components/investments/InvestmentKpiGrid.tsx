import { cn } from "@/lib/utils";
import type { InvestmentPortfolioMetrics } from "@/services/finance/investment-portfolio.service";

function fmt(n: number, decimals = 0) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Signed "SGD 1,234" / "−SGD 1,234" — same convention Dashboard's Cash Surplus already
 *  uses, reused here rather than inventing a second negative-value format. */
function signedSgd(n: number): string {
  return `${n < 0 ? "−" : ""}SGD ${fmt(Math.abs(n))}`;
}

/** One KPI cell — value, or the shared null-state ("—" + a short plain-text reason) when
 *  the metric genuinely can't be derived. Never substitutes zero for null. */
function KpiCell({ label, value, nullReason, negativeIsDestructive }: { label: string; value: number | null; nullReason?: string; negativeIsDestructive?: boolean }) {
  return (
    <div className="bg-card p-3">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {value === null ? (
        <>
          <p className="mt-0.5 font-mono text-[14px] font-bold tabular-nums text-muted-foreground">—</p>
          {nullReason && <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{nullReason}</p>}
        </>
      ) : (
        <p className={cn("mt-0.5 font-mono text-[14px] font-bold tabular-nums", negativeIsDestructive && value < 0 && "text-destructive")}>{signedSgd(value)}</p>
      )}
    </div>
  );
}

/** The four Investment Portfolio Version 1 metrics, in the same divided-grid visual
 *  language as AccountDetailView's existing "Account details" section — reused here
 *  rather than a new grid style. Every value comes straight from
 *  investment-portfolio.service.ts; this component performs no calculation of its own,
 *  only formatting and the shared null-state display. `variant` only changes cell order
 *  to match each screen's own spec — Portfolio Summary leads with Current Market Value,
 *  Account Detail leads with Capital Invested — the null-handling logic is identical
 *  either way, never duplicated. */
export function InvestmentKpiGrid({ metrics, variant }: { metrics: InvestmentPortfolioMetrics; variant: "summary" | "detail" }) {
  const currentMarketValue = (
    <KpiCell key="market-value" label="Current Market Value" value={metrics.currentMarketValueSgd} />
  );
  const capitalInvested = (
    <KpiCell key="capital-invested" label="Capital Invested" value={metrics.capitalInvestedSgd} nullReason="No transfer history recorded." />
  );
  const portfolioGainLoss = (
    <KpiCell
      key="gain-loss"
      label="Portfolio Gain/Loss"
      value={metrics.portfolioGainLossSgd}
      nullReason="Requires Capital Invested history."
      negativeIsDestructive
    />
  );
  const dividends = <KpiCell key="dividends" label="Dividends / Interest" value={metrics.dividendsSgd} />;

  const cells = variant === "summary" ? [currentMarketValue, capitalInvested, portfolioGainLoss, dividends] : [capitalInvested, currentMarketValue, portfolioGainLoss, dividends];

  return <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-border bg-border sm:grid-cols-4">{cells}</div>;
}
