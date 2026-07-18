"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { saveAllExchangeRatesAction } from "@/app/settings/actions";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";

type Row = {
  targetCurrency: string;
  rate: string;
  lastUpdated: string | null;
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Never set";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function ExchangeRatesView({ baseCurrency, rows }: { baseCurrency: string; rows: Row[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>(Object.fromEntries(rows.map((r) => [r.targetCurrency, r.rate])));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = rows.some((r) => drafts[r.targetCurrency] !== r.rate);

  function handleSaveAll() {
    setError(null);
    setSaved(false);

    // Client-side validation mirrors the server action so bad input never leaves the page.
    for (const r of rows) {
      const raw = String(drafts[r.targetCurrency] ?? "");
      if (raw.trim() === "") continue;
      const value = Number(raw);
      if (Number.isNaN(value) || value <= 0) {
        setError(`Rate for ${r.targetCurrency} must be a positive number.`);
        return;
      }
    }

    startTransition(async () => {
      try {
        await saveAllExchangeRatesAction(
          baseCurrency,
          rows.map((r) => ({ targetCurrency: r.targetCurrency, rate: drafts[r.targetCurrency] }))
        );
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save. Try again.");
      }
    });
  }

  return (
    <div className="px-5 pt-6 pb-8">
      <SettingsPageHeader title="Exchange Rates" />

      <p className="mb-4 text-[12px] text-muted-foreground">
        1 {baseCurrency} = rate × target currency. Used for current net worth, account balances, and investment
        valuation — historical calculations already saved are never recalculated.
      </p>

      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
        <div className="grid grid-cols-[1fr_auto_1fr_90px] items-center gap-2 bg-secondary px-3.5 py-2 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
          <span>Source</span>
          <span />
          <span>Target</span>
          <span className="text-right">Rate</span>
        </div>

        {rows.map((row, i) => (
          <div key={row.targetCurrency} className={cn("px-3.5 py-3", i > 0 && "border-t border-border")}>
            <div className="grid grid-cols-[1fr_auto_1fr_90px] items-center gap-2">
              <span className="text-[13.5px] font-bold">{baseCurrency}</span>
              <span className="text-muted-foreground">→</span>
              <span className="text-[13.5px] font-bold">{row.targetCurrency}</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.000001"
                min="0"
                value={drafts[row.targetCurrency]}
                onChange={(e) => {
                  setSaved(false);
                  setDrafts((d) => ({ ...d, [row.targetCurrency]: e.target.value }));
                }}
                placeholder="0.00"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-[13px] tabular-nums outline-none focus:border-primary"
              />
            </div>
            <p className="mt-1 text-[10.5px] text-muted-foreground">Updated: {formatTimestamp(row.lastUpdated)}</p>
          </div>
        ))}
      </div>

      {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
      {saved && !dirty && <p className="mt-2 text-[12px] text-primary">All rates saved.</p>}

      <button
        type="button"
        disabled={!dirty || pending}
        onClick={handleSaveAll}
        className="mt-4 w-full rounded-[var(--radius-md)] bg-primary py-2.5 text-[13.5px] font-semibold text-primary-foreground disabled:opacity-40"
      >
        {pending ? "Saving…" : "Save All"}
      </button>
    </div>
  );
}
