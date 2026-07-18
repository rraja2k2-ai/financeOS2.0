"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { BudgetType } from "@/domain/project";

const CURRENCIES = ["SGD", "INR", "USD", "MYR", "THB", "EUR", "VND", "IDR"];

export type ProjectFormValues = {
  projectName: string;
  description: string;
  startDate: string;
  endDate: string;
  budgetType: BudgetType;
  budgetCurrency: string;
};

const inputClass = "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-primary";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

export function ProjectForm({
  initial,
  submitLabel,
  pending,
  nameLocked,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<ProjectFormValues>;
  submitLabel: string;
  pending: boolean;
  /** Generic can't be renamed — lock the name field. */
  nameLocked?: boolean;
  onSubmit: (values: ProjectFormValues) => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<ProjectFormValues>({
    projectName: initial?.projectName ?? "",
    description: initial?.description ?? "",
    startDate: initial?.startDate ?? "",
    endDate: initial?.endDate ?? "",
    budgetType: initial?.budgetType ?? "Fixed",
    budgetCurrency: initial?.budgetCurrency ?? "SGD",
  });

  function set<K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>Project name</label>
        <input
          className={cn(inputClass, nameLocked && "opacity-60")}
          value={values.projectName}
          disabled={nameLocked}
          onChange={(e) => set("projectName", e.target.value)}
          placeholder="e.g. Japan Trip 2026"
        />
      </div>

      <div>
        <label className={labelClass}>Description</label>
        <textarea
          className={cn(inputClass, "resize-none")}
          rows={2}
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Optional"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Start date</label>
          <input type="date" className={inputClass} value={values.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>End date</label>
          <input type="date" className={inputClass} value={values.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Budget type</label>
          <div className="flex rounded-md border border-border p-0.5">
            {(["Fixed", "Track Only"] as BudgetType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set("budgetType", t)}
                className={cn(
                  "flex-1 rounded px-2 py-1 text-[11.5px] font-semibold",
                  values.budgetType === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>Budget currency</label>
          <select className={inputClass} value={values.budgetCurrency} onChange={(e) => set("budgetCurrency", e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={pending || !values.projectName.trim()}
          onClick={() => onSubmit({ ...values, projectName: values.projectName.trim() })}
          className="rounded-lg bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg border border-border px-3.5 py-1.5 text-[12.5px] font-semibold">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
