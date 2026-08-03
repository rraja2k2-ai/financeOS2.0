"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatFullDate } from "@/components/activity/activity-format";
import { currencyPrefix } from "@/lib/currency";
import type { CaptureMasterData } from "@/services/ai/ai-provider";
import type { RecurringRule, RecurringInterval } from "@/domain/recurring-rule";
import type { RecurringRuleFields } from "@/services/finance/recurring-rule.service";
import { RecurringRuleForm, type RecurringRuleFormValues } from "@/components/recurring/RecurringRuleForm";
import {
  updateRecurringRuleAction,
  setRecurringRuleActiveAction,
  deleteRecurringRuleAction,
  generateRecurringTransactionsAction,
} from "@/app/settings/recurring/actions";

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function unitLabel(unit: RecurringInterval, count: number): string {
  const word = unit === "WEEK" ? "Week" : unit === "MONTH" ? "Month" : "Year";
  return count === 1 ? word : `${word}s`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function valuesFromRule(rule: RecurringRule, accountsById: Record<string, string>, projectsById: Record<string, string>): RecurringRuleFormValues {
  return {
    merchant: rule.merchant,
    amount: Number(rule.amount).toFixed(2),
    primaryCategory: rule.primary_category,
    secondaryCategory: rule.secondary_category ?? "",
    sourceAccountName: rule.source_account_id ? (accountsById[rule.source_account_id] ?? "") : "",
    targetAccountName: rule.target_account_id ? (accountsById[rule.target_account_id] ?? "") : "",
    projectName: rule.project_id ? (projectsById[rule.project_id] ?? "") : "",
    comments: rule.comments ?? "",
    intervalCount: String(rule.interval_count),
    intervalUnit: rule.interval_unit,
    endMode: rule.end_mode,
    endDate: rule.end_mode === "ON_DATE" ? (rule.end_value ?? "") : "",
    occurrenceCount: "",
  };
}

export function RecurringView({
  rules,
  masterData,
  accountsById,
  projectsById,
}: {
  rules: RecurringRule[];
  masterData: CaptureMasterData;
  accountsById: Record<string, string>;
  projectsById: Record<string, string>;
}) {
  const router = useRouter();
  const [editingRule, setEditingRule] = useState<RecurringRule | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const [showCustomGenerate, setShowCustomGenerate] = useState(false);
  const [customDate, setCustomDate] = useState(todayIso());
  const [generating, setGenerating] = useState(false);
  const [generateSummary, setGenerateSummary] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  async function handleToggleActive(rule: RecurringRule) {
    setRowError(null);
    setBusyId(rule.id);
    try {
      await setRecurringRuleActiveAction(rule.id, !rule.is_active);
      router.refresh();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Couldn't update the rule.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(rule: RecurringRule) {
    setRowError(null);
    setBusyId(rule.id);
    try {
      await deleteRecurringRuleAction(rule.id);
      setConfirmingDeleteId(null);
      router.refresh();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Couldn't delete the rule.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleGenerate(until: string) {
    setGenerating(true);
    setGenerateError(null);
    setGenerateSummary(null);
    try {
      const results = await generateRecurringTransactionsAction(until);
      const totalGenerated = results.reduce((sum, r) => sum + r.transactionIds.length, 0);
      const failed = results.filter((r) => r.error);
      const parts = [`Generated ${totalGenerated} transaction${totalGenerated === 1 ? "" : "s"}.`];
      if (failed.length > 0) parts.push(`${failed.length} rule${failed.length === 1 ? "" : "s"} stopped early: ${failed.map((f) => f.error).join(" · ")}`);
      setGenerateSummary(parts.join(" "));
      router.refresh();
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Couldn't run Generate.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleEditSubmit(fields: RecurringRuleFields) {
    if (!editingRule) return;
    await updateRecurringRuleAction(editingRule.id, fields);
    setEditingRule(null);
    router.refresh();
  }

  return (
    <div className="px-5 pt-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-[22px] font-bold tracking-tight">Recurring</h1>
      </div>

      <div className="mb-5">
        <button
          type="button"
          disabled={generating}
          onClick={() => handleGenerate(todayIso())}
          className="w-full rounded-[var(--radius-md)] bg-primary py-2.5 text-[13.5px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {generating ? "Generating…" : "Generate Recurring Transactions"}
        </button>

        {/* Recovery-only path (missed months) — collapsed by default so the common case
            stays a single click with no modal. */}
        {!showCustomGenerate ? (
          <button
            type="button"
            onClick={() => setShowCustomGenerate(true)}
            className="mt-1.5 w-full text-center text-[11.5px] font-semibold text-muted-foreground"
          >
            Missed a few months? Generate up to a custom date
          </button>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="date"
              max={todayIso()}
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-primary [color-scheme:dark]"
            />
            <button
              type="button"
              disabled={generating}
              onClick={() => handleGenerate(customDate)}
              className="rounded-md border border-border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
            >
              Generate
            </button>
          </div>
        )}

        {generateSummary && <p className="mt-2 text-[12.5px] font-semibold text-primary">{generateSummary}</p>}
        {generateError && <p className="mt-2 text-[12px] font-semibold text-destructive">{generateError}</p>}
      </div>

      {rowError && <p className="mb-3 text-[12px] font-semibold text-destructive">{rowError}</p>}

      {rules.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
          No recurring rules yet. Create one from a transaction&rsquo;s &ldquo;Make Recurring&rdquo; action.
        </div>
      ) : (
        <div className="space-y-2.5">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-[var(--radius-lg)] border border-border bg-card p-3.5 shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-bold">{rule.merchant || rule.primary_category}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    Every {rule.interval_count} {unitLabel(rule.interval_unit, rule.interval_count)} · Next due {formatFullDate(rule.next_due_date)}
                  </p>
                </div>
                <div className="flex flex-none flex-col items-end">
                  <span className="font-mono text-[14px] font-bold tabular-nums">
                    {currencyPrefix(rule.currency)}
                    {fmt(Number(rule.amount))}
                  </span>
                  <span
                    className={
                      rule.is_active
                        ? "mt-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-primary"
                        : "mt-1 rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground"
                    }
                  >
                    {rule.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-4 border-t border-border pt-2.5 text-[12.5px] font-semibold">
                <button type="button" onClick={() => setEditingRule(rule)} className="text-primary">
                  Edit
                </button>
                <button type="button" disabled={busyId === rule.id} onClick={() => handleToggleActive(rule)} className="text-foreground disabled:opacity-50">
                  {rule.is_active ? "Deactivate" : "Activate"}
                </button>
                <button type="button" onClick={() => setConfirmingDeleteId(rule.id)} className="text-destructive">
                  Delete
                </button>
              </div>

              {confirmingDeleteId === rule.id && (
                <div className="mt-3 rounded-lg border border-destructive/40 bg-background p-3">
                  <p className="text-[12.5px] font-semibold">Delete this recurring rule?</p>
                  <p className="mt-1 text-[11.5px] text-muted-foreground">Already-generated transactions are never affected.</p>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === rule.id}
                      onClick={() => handleDelete(rule)}
                      className="flex-1 rounded-md bg-destructive py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                    >
                      {busyId === rule.id ? "Deleting…" : "Delete"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === rule.id}
                      onClick={() => setConfirmingDeleteId(null)}
                      className="flex-1 rounded-md border border-border py-1.5 text-[12px] font-semibold disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editingRule && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/50 px-6 py-10">
          <div className="w-full max-w-[380px] rounded-[var(--radius-lg)] border border-border bg-card p-5">
            <p className="text-[14.5px] font-bold">Edit Recurring Rule</p>
            <RecurringRuleForm
              transactionType={editingRule.transaction_type}
              currency={editingRule.currency}
              initialValues={valuesFromRule(editingRule, accountsById, projectsById)}
              masterData={masterData}
              submitLabel="Save Changes"
              onSubmit={handleEditSubmit}
              onCancel={() => setEditingRule(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
