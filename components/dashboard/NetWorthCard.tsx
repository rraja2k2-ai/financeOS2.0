import { GlassPanel } from "@/components/ui/GlassPanel";

interface NetWorthCardProps {
  netWorth: number;
  privacyOn: boolean;
}

export function NetWorthCard({ netWorth, privacyOn }: NetWorthCardProps) {
  return (
    <GlassPanel className="mb-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
        Net worth
      </p>
      <p className={`text-4xl font-bold text-on-surface balance-figure ${privacyOn ? "balance-hidden" : ""}`}>
        SGD {netWorth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
      <p className="text-sm text-on-surface-variant mt-1">
        Across SGD, INR, USD and others · illustrative FX
      </p>
    </GlassPanel>
  );
}
