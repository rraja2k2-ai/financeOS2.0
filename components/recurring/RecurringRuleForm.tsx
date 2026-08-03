"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { CaptureMasterData } from "@/services/ai/ai-provider";
import type { RecurringInterval, RecurringEndMode } from "@/domain/recurring-rule";
import type { RecurringRuleFields } from "@/services/finance/recurring-rule.service";
import { TRANSACTION_TYPES } from "@/constants/transaction-types";

const inputClass = "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-primary";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

export type RecurringRuleFormValues = {
  merchant: string;
  amount: string;
  primaryCategory: string;
  secondaryCategory: string;
  sourceAccountName: string;
  targetAccountName: string;
  projectName: string;
  comments: string;
  intervalCount: string;
  intervalUnit: RecurringInterval;
  endMode: RecurringEndMode;
  endDate: string;
  occurrenceCount: string;
};

/**
 * Shared by "Make Recurring" (ReviewScreen) and "Edit" (the Recurring page) — one form,
 * two call sites, matching how CorrectBalanceForm is already shared across two entry
 * points elsewhere in this app. transaction_type is never a field here — it's fixed at
 * creation (inherited from the source transaction) and never editable afterward, per the
 * Rule Editing decision (merchant/amount/category/account/project/comments/frequency
 * only). start_date/next_due_date aren't fields here either — see recurring-rule.service.ts.
 */
export function RecurringRuleForm({
  transactionType,
  currency,
  initialValues,
  masterData,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  transactionType: string;
  currency: string;
  initialValues: RecurringRuleFormValues;
  masterData: CaptureMasterData;
  submitLabel: string;
  onSubmit: (fields: RecurringRuleFields) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function set<K extends keyof RecurringRuleFormValues>(key: K, value: RecurringRuleFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  const showDestination = transactionType === TRANSACTION_TYPES.TRANSFER || transactionType === TRANSACTION_TYPES.INCOME;
  const primaryOptions = [...new Set(masterData.categories.map((c) => c.primary))];
  const subcategoriesFor = (primary: string) => [
    ...new Set(masterData.categories.filter((c) => c.primary === primary).flatMap((c) => c.subcategories)),
  ];

  async function handleSubmit() {
    setError(null);

    const amount = Number(values.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      setError("Enter a valid, non-zero amount.");
      return;
    }
    const intervalCount = Number(values.intervalCount);
    if (!Number.isInteger(intervalCount) || intervalCount < 1) {
      setError("Repeat interval must be a whole number of at least 1.");
      return;
    }
    if (values.endMode === "ON_DATE" && !values.endDate) {
      setError("Choose an end date.");
      return;
    }
    if (values.endMode === "AFTER_COUNT" && (!values.occurrenceCount || Number(values.occurrenceCount) < 1)) {
      setError("Enter the number of occurrences.");
      return;
    }

    setPending(true);
    try {
      await onSubmit({
        transaction_type: transactionType,
        merchant: values.merchant,
        amount,
        currency,
        primary_category: values.primaryCategory,
        secondary_category: values.secondaryCategory || null,
        source_account_name: values.sourceAccountName || null,
        target_account_name: showDestination ? values.targetAccountName || null : null,
        project_name: values.projectName || null,
        comments: values.comments || null,
        interval_count: intervalCount,
        interval_unit: values.intervalUnit,
        end_mode: values.endMode,
        end_date: values.endMode === "ON_DATE" ? values.endDate : null,
        occurrence_count: values.endMode === "AFTER_COUNT" ? Number(values.occurrenceCount) : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the recurring rule.");
      setPending(false);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div>
        <label className={labelClass}>Merchant</label>
        <input className={inputClass} value={values.merchant} onChange={(e) => set("merchant", e.target.value)} />
      </div>
      <div>
        <label className={labelClass}>Amount ({currency})</label>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          className={inputClass}
          value={values.amount}
          onChange={(e) => set("amount", e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Category</label>
          <select
            className={inputClass}
            value={values.primaryCategory}
            onChange={(e) => {
              set("primaryCategory", e.target.value);
              set("secondaryCategory", "");
            }}
          >
            <option value="">—</option>
            {primaryOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Subcategory</label>
          <select className={inputClass} value={values.secondaryCategory} onChange={(e) => set("secondaryCategory", e.target.value)}>
            <option value="">—</option>
            {subcategoriesFor(values.primaryCategory).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className={showDestination ? "grid grid-cols-2 gap-2" : ""}>
        <div>
          <label className={labelClass}>Account</label>
          <select className={inputClass} value={values.sourceAccountName} onChange={(e) => set("sourceAccountName", e.target.value)}>
            <option value="">—</option>
            {masterData.accounts.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        {showDestination && (
          <div>
            <label className={labelClass}>Destination</label>
            <select className={inputClass} value={values.targetAccountName} onChange={(e) => set("targetAccountName", e.target.value)}>
              <option value="">—</option>
              {masterData.accounts.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div>
        <label className={labelClass}>Project</label>
        <select className={inputClass} value={values.projectName} onChange={(e) => set("projectName", e.target.value)}>
          <option value="">—</option>
          {masterData.projects.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Notes</label>
        <input className={inputClass} value={values.comments} onChange={(e) => set("comments", e.target.value)} />
      </div>
      <div>
        <label className={labelClass}>Repeat Every</label>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step="1"
            className={cn(inputClass, "w-20")}
            value={values.intervalCount}
            onChange={(e) => set("intervalCount", e.target.value)}
          />
          <select className={inputClass} value={values.intervalUnit} onChange={(e) => set("intervalUnit", e.target.value as RecurringInterval)}>
            <option value="WEEK">Week(s)</option>
            <option value="MONTH">Month(s)</option>
            <option value="YEAR">Year(s)</option>
          </select>
        </div>
      </div>
      <div>
        <label className={labelClass}>Ends</label>
        <select className={inputClass} value={values.endMode} onChange={(e) => set("endMode", e.target.value as RecurringEndMode)}>
          <option value="NEVER">Never</option>
          <option value="ON_DATE">On Date</option>
          <option value="AFTER_COUNT">After N Occurrences</option>
        </select>
        {values.endMode === "ON_DATE" && (
          <input
            type="date"
            className={cn(inputClass, "mt-2 [color-scheme:dark]")}
            value={values.endDate}
            onChange={(e) => set("endDate", e.target.value)}
          />
        )}
        {values.endMode === "AFTER_COUNT" && (
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step="1"
            placeholder="Number of occurrences"
            className={cn(inputClass, "mt-2")}
            value={values.occurrenceCount}
            onChange={(e) => set("occurrenceCount", e.target.value)}
          />
        )}
      </div>

      {error && <p className="text-[12px] font-semibold text-destructive">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={pending}
          onClick={handleSubmit}
          className="flex-1 rounded-lg bg-primary py-2 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        <button type="button" disabled={pending} onClick={onCancel} className="flex-1 rounded-lg border border-border py-2 text-[13px] font-semibold disabled:opacity-50">
          Cancel
        </button>
      </div>
    </div>
  );
}
