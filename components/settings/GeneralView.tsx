"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { updateBaseCurrencyAction } from "@/app/settings/actions";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { BASE_CURRENCIES, type BaseCurrency } from "@/domain/exchange-rate";

export function GeneralView({ baseCurrency }: { baseCurrency: BaseCurrency }) {
  const [current, setCurrent] = useState(baseCurrency);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSelect(next: BaseCurrency) {
    if (next === current || pending) return;
    setError(null);
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      try {
        await updateBaseCurrencyAction(next);
      } catch {
        setCurrent(previous);
        setError("Could not update base currency. Try again.");
      }
    });
  }

  return (
    <div className="px-5 pt-6 pb-8">
      <SettingsPageHeader title="General" />

      <section>
        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Base Currency</p>
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          {BASE_CURRENCIES.map((code, i) => (
            <button
              key={code}
              type="button"
              disabled={pending}
              onClick={() => handleSelect(code)}
              className={cn("flex w-full items-center justify-between p-4 text-left disabled:opacity-60", i > 0 && "border-t border-border")}
            >
              <span className="text-[14px] font-semibold">{code}</span>
              {current === code && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>
        {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
        <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
          Only one base currency is active at a time. Changing it updates the Exchange Rates screen and all
          exchange_rates rows immediately, but never rewrites historical snapshots — only future calculations use
          the new base currency.
        </p>
      </section>
    </div>
  );
}
