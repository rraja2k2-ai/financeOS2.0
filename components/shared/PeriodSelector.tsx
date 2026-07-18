"use client";

import { cn } from "@/lib/utils";
import { PERIOD_OPTIONS, type PeriodKey } from "@/lib/period";

export type PeriodSelectorProps = {
  period: PeriodKey;
  onPeriodChange: (period: PeriodKey) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (date: string) => void;
  onCustomEndChange: (date: string) => void;
};

/** Shared "This month / Last 3 / Last 6 / Custom date" control — used by Activity and Budget. */
export function PeriodSelector({
  period,
  onPeriodChange,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
}: PeriodSelectorProps) {
  return (
    <div className="mb-4">
      <div className="flex gap-2 overflow-x-auto">
        {PERIOD_OPTIONS.map((p) => (
          <button
            key={p.key}
            onClick={() => onPeriodChange(p.key)}
            className={cn(
              "flex-none whitespace-nowrap rounded-full border border-border px-3.5 py-1.5 text-[12.5px] font-semibold",
              period === p.key ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {period === "custom" && (
        <div className="mt-2.5 flex items-center gap-2">
          <label className="flex-1 text-[11.5px]">
            <span className="mb-1 block font-semibold text-muted-foreground">From</span>
            <input
              type="date"
              value={customStart}
              onChange={(e) => onCustomStartChange(e.target.value)}
              max={customEnd}
              className="w-full rounded-[var(--radius-md)] border border-border bg-card px-2.5 py-2 text-[12.5px] outline-none focus:border-primary"
            />
          </label>
          <label className="flex-1 text-[11.5px]">
            <span className="mb-1 block font-semibold text-muted-foreground">To</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => onCustomEndChange(e.target.value)}
              min={customStart}
              className="w-full rounded-[var(--radius-md)] border border-border bg-card px-2.5 py-2 text-[12.5px] outline-none focus:border-primary"
            />
          </label>
        </div>
      )}
    </div>
  );
}
