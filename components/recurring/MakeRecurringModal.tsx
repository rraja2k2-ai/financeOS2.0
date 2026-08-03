"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { RecurringInterval, RecurringEndMode } from "@/domain/recurring-rule";
import { createRecurringRuleFromTransactionAction } from "@/app/settings/recurring/actions";

const inputClass = "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-primary";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

/**
 * "Make Recurring" (Transaction Details / Edit Transaction) — the smallest possible
 * creation form: only the recurrence settings, since merchant/category/account/project/
 * comments are silently inherited from the transaction (services/finance/
 * recurring-rule.service.ts's createRecurringRuleFromTransaction). Editing those later
 * happens from the Recurring page's own Edit action, never here.
 */
export function MakeRecurringModal({ headerId, onDone, onCancel }: { headerId: string; onDone: () => void; onCancel: () => void }) {
  const [intervalCount, setIntervalCount] = useState("1");
  const [intervalUnit, setIntervalUnit] = useState<RecurringInterval>("MONTH");
  const [endMode, setEndMode] = useState<RecurringEndMode>("NEVER");
  const [endDate, setEndDate] = useState("");
  const [occurrenceCount, setOccurrenceCount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit() {
    setError(null);
    const count = Number(intervalCount);
    if (!Number.isInteger(count) || count < 1) {
      setError("Repeat interval must be a whole number of at least 1.");
      return;
    }
    if (endMode === "ON_DATE" && !endDate) {
      setError("Choose an end date.");
      return;
    }
    if (endMode === "AFTER_COUNT" && (!occurrenceCount || Number(occurrenceCount) < 1)) {
      setError("Enter the number of occurrences.");
      return;
    }

    setPending(true);
    try {
      await createRecurringRuleFromTransactionAction(headerId, {
        intervalCount: count,
        intervalUnit,
        endMode,
        endDate: endMode === "ON_DATE" ? endDate : null,
        occurrenceCount: endMode === "AFTER_COUNT" ? Number(occurrenceCount) : null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the recurring rule.");
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/50 px-6 py-10">
      <div className="w-full max-w-[340px] rounded-[var(--radius-lg)] border border-border bg-card p-5">
        <p className="text-[14.5px] font-bold">Make Recurring</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Merchant, category, account, and project are reused from this transaction — edit them later from the Recurring page.
        </p>

        <div className="mt-3 space-y-3">
          <div>
            <label className={labelClass}>Repeat Every</label>
            <div className="flex gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step="1"
                className={cn(inputClass, "w-20")}
                value={intervalCount}
                onChange={(e) => setIntervalCount(e.target.value)}
              />
              <select className={inputClass} value={intervalUnit} onChange={(e) => setIntervalUnit(e.target.value as RecurringInterval)}>
                <option value="WEEK">Week(s)</option>
                <option value="MONTH">Month(s)</option>
                <option value="YEAR">Year(s)</option>
              </select>
            </div>
          </div>
          <div>
            <label className={labelClass}>Ends</label>
            <select className={inputClass} value={endMode} onChange={(e) => setEndMode(e.target.value as RecurringEndMode)}>
              <option value="NEVER">Never</option>
              <option value="ON_DATE">On Date</option>
              <option value="AFTER_COUNT">After N Occurrences</option>
            </select>
            {endMode === "ON_DATE" && (
              <input
                type="date"
                className={cn(inputClass, "mt-2 [color-scheme:dark]")}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            )}
            {endMode === "AFTER_COUNT" && (
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step="1"
                placeholder="Number of occurrences"
                className={cn(inputClass, "mt-2")}
                value={occurrenceCount}
                onChange={(e) => setOccurrenceCount(e.target.value)}
              />
            )}
          </div>
        </div>

        {error && <p className="mt-3 text-[12px] font-semibold text-destructive">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={handleSubmit}
            className="flex-1 rounded-lg bg-primary py-2 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Saving…" : "Create"}
          </button>
          <button type="button" disabled={pending} onClick={onCancel} className="flex-1 rounded-lg border border-border py-2 text-[13px] font-semibold disabled:opacity-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
