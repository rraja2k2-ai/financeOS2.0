"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { BASE_CURRENCIES, SUPPORTED_TARGET_CURRENCIES } from "@/domain/exchange-rate";
import type { CaptureMasterData, CaptureReceiptResult } from "@/services/ai/ai-provider";
import type { ReviewedCapture } from "@/services/capture/save-capture.service";

/**
 * FinanceOS Review Screen (C3) — replaces the temporary Developer Viewer.
 *
 * Full-screen modal where the user verifies and edits the AI-extracted data before
 * saving. Everything here is local state: no AI calls, no Supabase queries (dropdowns
 * come from the master data the capture session already loaded), and no persistence —
 * Save stays disabled until Milestone C4.
 */

type HeaderDraft = {
  merchant: string;
  transactionDate: string;
  currency: string;
  paymentMethod: string;
  account: string;
  project: string;
  notes: string;
};

type ItemDraft = {
  description: string;
  /** Free text combining value and unit, e.g. "0.546 kg", "2 pcs", "500 ml". */
  qty: string;
  amount: string;
  primaryCategory: string;
  secondaryCategory: string;
};

const CURRENCIES: string[] = [...new Set<string>([...BASE_CURRENCIES, ...SUPPORTED_TARGET_CURRENCIES])];

/** Every transaction belongs to a project — when the AI doesn't suggest one, default to Generic. */
const DEFAULT_PROJECT = "Generic";

function draftsFromResult(result: CaptureReceiptResult): { header: HeaderDraft; items: ItemDraft[] } {
  return {
    header: {
      merchant: result.header.merchant ?? "",
      transactionDate: result.header.transactionDate ?? "",
      currency: result.header.currency ?? "",
      paymentMethod: result.header.paymentMethod ?? "",
      account: result.headerSuggestions.account ?? "",
      project: result.headerSuggestions.project ?? DEFAULT_PROJECT,
      notes: result.header.notes ?? "",
    },
    items: result.items.map((item) => ({
      description: item.description,
      // Qty is a single free-text field combining value + unit ("0.26 kg", "2 pcs").
      qty: [item.qty !== null ? String(item.qty) : null, item.unit].filter(Boolean).join(" "),
      amount: item.lineAmount !== null ? String(item.lineAmount) : "",
      primaryCategory: item.primaryCategory ?? "",
      secondaryCategory: item.secondaryCategory ?? "",
    })),
  };
}

/** Ensure the current value stays selectable even if it isn't in the master list. */
function withCurrent(options: string[], current: string): string[] {
  return current && !options.includes(current) ? [current, ...options] : options;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Qty is free text ("0.5 kg", "2 pcs"); flag it only when its leading number is negative. */
function qtyIsNegative(qty: string): boolean {
  const match = qty.trim().match(/^-?\d*\.?\d+/);
  return match !== null && Number(match[0]) < 0;
}

export function ReviewScreen({
  result,
  masterData,
  onCancel,
  onSave,
}: {
  result: CaptureReceiptResult;
  masterData: CaptureMasterData;
  onCancel: () => void;
  /** Persist the reviewed data. Resolves on success (parent closes this screen), rejects with a friendly message on failure (this screen stays open). */
  onSave: (reviewed: ReviewedCapture) => Promise<void>;
}) {
  const [{ header, items }] = useState(() => draftsFromResult(result));
  const [headerDraft, setHeaderDraft] = useState<HeaderDraft>(header);
  const [itemDrafts, setItemDrafts] = useState<ItemDraft[]>(items);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onCancel]);

  function setHeader<K extends keyof HeaderDraft>(key: K, value: string) {
    setHeaderDraft((h) => ({ ...h, [key]: value }));
  }

  function setItem(index: number, patch: Partial<ItemDraft>) {
    setItemDrafts((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  // The taxonomy can contain the same primary name on both the income and expense side
  // (e.g. "Investments") — dedupe for the dropdown and merge subcategories across both.
  const primaryOptions = useMemo(() => [...new Set(masterData.categories.map((c) => c.primary))], [masterData.categories]);

  const subcategoriesFor = (primary: string): string[] => [
    ...new Set(masterData.categories.filter((c) => c.primary === primary).flatMap((c) => c.subcategories)),
  ];

  // Live summary — recomputed from the edited amounts. Tax/discount come from the AI
  // header and are read-only in C3.
  const tax = result.header.tax ?? 0;
  const discount = result.header.discount ?? 0;
  const subtotal = itemDrafts.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const grandTotal = subtotal + tax - discount;

  // Basic client-side validation only (no server validation in C3).
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (!headerDraft.merchant.trim()) errors.push("Merchant cannot be empty.");
    if (itemDrafts.length === 0) errors.push("At least one line item is required.");
    if (itemDrafts.some((i) => i.amount.trim() !== "" && Number(i.amount) < 0)) errors.push("Amounts cannot be negative.");
    if (itemDrafts.some((i) => qtyIsNegative(i.qty))) errors.push("Quantities cannot be negative.");
    return errors;
  }, [headerDraft.merchant, itemDrafts]);

  const canSave = validationErrors.length === 0 && !saving;

  // Gather the EDITED values into the reviewed model and hand them to the parent to
  // persist. No persistence logic lives here — the screen only collects what the user
  // verified. On failure the screen stays open with the data intact.
  async function handleSave() {
    if (!canSave) return;
    setSaveError(null);
    setSaving(true);
    try {
      const reviewed: ReviewedCapture = {
        header: { ...headerDraft, project: headerDraft.project || DEFAULT_PROJECT },
        items: itemDrafts.map((i) => ({
          description: i.description,
          qty: i.qty,
          amount: i.amount,
          primaryCategory: i.primaryCategory,
          secondaryCategory: i.secondaryCategory,
        })),
        tax: result.header.tax,
        discount: result.header.discount,
      };
      await onSave(reviewed);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save the transaction. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-background" role="dialog" aria-modal="true" aria-label="Review capture">
      <div className="mx-auto flex min-h-full max-w-[480px] flex-col px-5 pt-5">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-[19px] font-bold tracking-tight">Review</h1>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel review"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Receipt Summary */}
        <section className="mb-5">
          <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Receipt summary</p>
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
            <FieldRow label="Merchant" invalid={!headerDraft.merchant.trim()}>
              <input
                value={headerDraft.merchant}
                onChange={(e) => setHeader("merchant", e.target.value)}
                placeholder="Required"
                className={fieldInputClass}
              />
            </FieldRow>
            <FieldRow label="Date">
              <input
                type="date"
                value={headerDraft.transactionDate}
                onChange={(e) => setHeader("transactionDate", e.target.value)}
                className={fieldInputClass}
              />
            </FieldRow>
            <FieldRow label="Currency">
              <select
                value={headerDraft.currency}
                onChange={(e) => setHeader("currency", e.target.value)}
                className={fieldSelectClass}
              >
                <option value="">—</option>
                {withCurrent(CURRENCIES, headerDraft.currency).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </FieldRow>
            <FieldRow label="Account">
              <select value={headerDraft.account} onChange={(e) => setHeader("account", e.target.value)} className={fieldSelectClass}>
                <option value="">—</option>
                {withCurrent(masterData.accounts.map((a) => a.name), headerDraft.account).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </FieldRow>
            <FieldRow label="Project" last>
              <select value={headerDraft.project} onChange={(e) => setHeader("project", e.target.value)} className={fieldSelectClass}>
                <option value="">—</option>
                {withCurrent(masterData.projects.map((p) => p.name), headerDraft.project).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </FieldRow>
          </div>
        </section>

        {/* Line Items */}
        <section className="mb-5">
          <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
            Line items · {itemDrafts.length}
          </p>
          {itemDrafts.length === 0 ? (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
              No line items were extracted.
            </div>
          ) : (
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
              {itemDrafts.map((item, i) => (
                <div key={i} className={cn("p-3.5", i > 0 && "border-t border-border")}>
                  <input
                    value={item.description}
                    onChange={(e) => setItem(i, { description: e.target.value })}
                    placeholder="Description"
                    className="w-full bg-transparent text-[13.5px] font-semibold outline-none placeholder:text-muted-foreground/60 focus:text-primary"
                  />

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <LabeledInput label="Qty">
                      <input
                        value={item.qty}
                        onChange={(e) => setItem(i, { qty: e.target.value })}
                        placeholder="e.g. 0.5 kg"
                        className={cn(cellInputClass, qtyIsNegative(item.qty) && "text-destructive")}
                      />
                    </LabeledInput>
                    <LabeledInput label="Amount">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        value={item.amount}
                        onChange={(e) => setItem(i, { amount: e.target.value })}
                        placeholder="0.00"
                        className={cn(cellInputClass, item.amount.trim() !== "" && Number(item.amount) < 0 && "text-destructive")}
                      />
                    </LabeledInput>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <LabeledInput label="Category">
                      <select
                        value={item.primaryCategory}
                        onChange={(e) => {
                          const primary = e.target.value;
                          // Keep the subcategory only if it belongs to the new category.
                          const keepSecondary = subcategoriesFor(primary).includes(item.secondaryCategory);
                          setItem(i, { primaryCategory: primary, secondaryCategory: keepSecondary ? item.secondaryCategory : "" });
                        }}
                        className={cellSelectClass}
                      >
                        <option value="">—</option>
                        {withCurrent(primaryOptions, item.primaryCategory).map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </LabeledInput>
                    <LabeledInput label="Subcategory">
                      <select
                        value={item.secondaryCategory}
                        onChange={(e) => setItem(i, { secondaryCategory: e.target.value })}
                        className={cellSelectClass}
                      >
                        <option value="">—</option>
                        {withCurrent(subcategoriesFor(item.primaryCategory), item.secondaryCategory).map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </LabeledInput>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Summary (read-only) */}
        <section className="mb-5">
          <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Summary</p>
          <div className="rounded-[var(--radius-lg)] border border-border bg-card p-3.5">
            <SummaryRow label="Subtotal" value={`${headerDraft.currency || ""} ${fmt(subtotal)}`} />
            <SummaryRow label="Tax" value={result.header.tax !== null ? `${headerDraft.currency || ""} ${fmt(tax)}` : "—"} />
            <SummaryRow label="Discount" value={result.header.discount !== null ? `− ${headerDraft.currency || ""} ${fmt(discount)}` : "—"} />
            <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2.5">
              <span className="text-[13px] font-bold">Grand total</span>
              <span className="font-mono text-[15px] font-bold tabular-nums">
                {headerDraft.currency || ""} {fmt(grandTotal)}
              </span>
            </div>
          </div>
        </section>

        {validationErrors.length > 0 && (
          <div className="mb-4 rounded-[var(--radius-md)] border border-destructive/40 bg-card p-3">
            {validationErrors.map((msg) => (
              <p key={msg} className="text-[12px] font-semibold text-destructive">
                {msg}
              </p>
            ))}
          </div>
        )}

        {/* Sticky action bar */}
        <div className="sticky bottom-0 mt-auto border-t border-border bg-background/95 pb-6 pt-3 backdrop-blur-md">
          {saveError && <p className="mb-2 text-[12px] font-semibold text-destructive">{saveError}</p>}
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="flex-1 rounded-[var(--radius-md)] border border-border bg-card py-3 text-[14px] font-semibold disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="flex-1 rounded-[var(--radius-md)] bg-primary py-3 text-[14px] font-semibold text-primary-foreground disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const fieldInputClass =
  "w-full bg-transparent text-right text-[13.5px] font-semibold outline-none placeholder:text-muted-foreground/60 focus:text-primary";
const fieldSelectClass = "w-full bg-transparent text-right text-[13.5px] font-semibold outline-none focus:text-primary";
const cellInputClass =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[12.5px] tabular-nums outline-none focus:border-primary";
const cellSelectClass = "w-full rounded-md border border-border bg-background px-1.5 py-1.5 text-[12px] outline-none focus:border-primary";

function FieldRow({ label, children, last, invalid }: { label: string; children: React.ReactNode; last?: boolean; invalid?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 px-3.5 py-3", !last && "border-b border-border")}>
      <span className={cn("w-[84px] flex-none text-[12px] font-semibold text-muted-foreground", invalid && "text-destructive")}>{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function LabeledInput({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[13px] font-semibold tabular-nums">{value}</span>
    </div>
  );
}
