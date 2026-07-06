import { GlassPanel } from "@/components/ui/GlassPanel";

interface StatsCardsProps {
  availableToInvest: number;
  budgetPercentage: number;
  budgetSpent: number;
  budgetTotal: number;
  privacyOn: boolean;
}

export function StatsCards({
  availableToInvest,
  budgetPercentage,
  budgetSpent,
  budgetTotal,
  privacyOn,
}: StatsCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 mb-4">
      <GlassPanel>
        <span className="text-tertiary mb-2">savings</span>
        <p className="text-xs font-semibold text-on-surface-variant mb-1">
          Available to invest
        </p>
        <p className={`text-2xl font-semibold text-tertiary balance-figure ${privacyOn ? "balance-hidden" : ""}`}>
          SGD {availableToInvest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <p className="text-sm text-on-surface-variant mt-1">
          Income − spend − reserve
        </p>
      </GlassPanel>
      <GlassPanel>
        <span className="text-secondary mb-2">bar_chart</span>
        <p className="text-xs font-semibold text-on-surface-variant mb-1">
          Budget vs spend
        </p>
        <p className={`text-2xl font-semibold text-on-surface balance-figure ${privacyOn ? "balance-hidden" : ""}`}>
          {budgetPercentage}%
        </p>
        <div className="w-full h-1.5 rounded-full bg-surface-container-highest mt-2 overflow-hidden">
          <div className="h-full bg-secondary" style={{ width: `${budgetPercentage}%` }} />
        </div>
        <p className="text-sm text-on-surface-variant mt-1">
          {budgetSpent.toLocaleString()} of {budgetTotal.toLocaleString()} SGD
        </p>
      </GlassPanel>
    </div>
  );
}
