"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, FolderKanban, Wallet, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { currencyPrefix } from "@/lib/currency";
import { BASE_CURRENCIES, SUPPORTED_TARGET_CURRENCIES } from "@/domain/exchange-rate";
import type { CaptureMasterData, CaptureReceiptResult } from "@/services/ai/ai-provider";
import type { ReviewedCapture } from "@/services/capture/save-capture.service";
import { reviewedFromResult } from "@/services/capture/reviewed-from-result";

/**
 * FinanceOS Review Screen (C3) — replaces the temporary Developer Viewer.
 *
 * Full-screen modal where the user verifies and edits the AI-extracted data before
 * saving. Everything here is local state: no AI calls, no Supabase queries (dropdowns
 * come from the master data the capture session already loaded), and no persistence —
 * Save stays disabled until Milestone C4.
 *
 * UI Phase 2 (Premium Review Screen): presentation-only redesign — sticky header with a
 * large live total, line items as individual cards, a two-tier category picker, and a
 * sticky bottom action bar. Every piece of state, validation, and the save contract
 * below is unchanged from the prior version; only the JSX changed.
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
  const reviewed = reviewedFromResult(result);
  return {
    header: { ...reviewed.header, project: reviewed.header.project || DEFAULT_PROJECT },
    items: reviewed.items,
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
  /** Progressive disclosure (UI Phase — Premium AI Review Line Items): a single index, so
   *  expanding one card always collapses whichever was open — never a per-item flag. Purely
   *  presentational; itemDrafts (the actual edited values) is unaffected by collapsing. */
  const [expandedItem, setExpandedItem] = useState<number | null>(null);

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
    <div className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-background" role="dialog" aria-modal="true" aria-label="Review capture">
      <div className="mx-auto flex min-h-full w-full max-w-[480px] flex-col">
        {/* Premium sticky header — merchant, large live total, date + item count, then a
            compact metadata row for the secondary fields (currency/account/project). */}
        <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-5 pt-5 backdrop-blur-md">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Reviewing capture</p>
              <input
                value={headerDraft.merchant}
                onChange={(e) => setHeader("merchant", e.target.value)}
                placeholder="Merchant"
                aria-invalid={!headerDraft.merchant.trim()}
                className={cn(
                  "w-full truncate bg-transparent text-[21px] font-bold leading-tight tracking-tight outline-none",
                  "placeholder:text-muted-foreground/60 focus:text-primary",
                  !headerDraft.merchant.trim() && "text-destructive"
                )}
              />
            </div>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancel review"
              className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-border bg-card text-muted-foreground"
            >
              <X size={16} strokeWidth={2.3} />
            </button>
          </div>

          {/* Transaction Total — second-strongest element after Merchant (consistency with
              Activity's header hierarchy); previously 34px, larger than Merchant's 21px,
              which inverted that hierarchy. */}
          <div className="mb-3 font-mono text-[18px] font-bold leading-none tabular-nums">
            {currencyPrefix(headerDraft.currency)}
            {fmt(grandTotal)}
          </div>

          <div className="mb-4 flex items-center gap-2.5 text-[12.5px] text-muted-foreground">
            <input
              type="date"
              value={headerDraft.transactionDate}
              onChange={(e) => setHeader("transactionDate", e.target.value)}
              className="bg-transparent font-semibold text-foreground outline-none focus:text-primary [color-scheme:dark]"
            />
            <span aria-hidden="true">·</span>
            <span>
              {itemDrafts.length} item{itemDrafts.length === 1 ? "" : "s"}
            </span>
          </div>

          {/* Compact metadata row — secondary fields, out of the way of the primary summary. */}
          <div className="-mx-5 flex items-center gap-2 overflow-x-auto px-5 pb-4">
            <MetaPill label="Currency">
              <select value={headerDraft.currency} onChange={(e) => setHeader("currency", e.target.value)} className={metaSelectClass}>
                <option value="">—</option>
                {withCurrent(CURRENCIES, headerDraft.currency).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </MetaPill>
            <MetaPill label="Account" icon={<Wallet size={12} strokeWidth={2.3} />}>
              <select value={headerDraft.account} onChange={(e) => setHeader("account", e.target.value)} className={metaSelectClass}>
                <option value="">—</option>
                {withCurrent(masterData.accounts.map((a) => a.name), headerDraft.account).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </MetaPill>
            <MetaPill label="Project" icon={<FolderKanban size={12} strokeWidth={2.3} />}>
              <select value={headerDraft.project} onChange={(e) => setHeader("project", e.target.value)} className={metaSelectClass}>
                <option value="">—</option>
                {withCurrent(masterData.projects.map((p) => p.name), headerDraft.project).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </MetaPill>
          </div>
        </header>

        {/* Scrollable body */}
        <div className="flex-1 px-5 py-5">
          {/* Line items — one card each */}
          <section className="mb-5">
            <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Items · {itemDrafts.length}</p>
            {itemDrafts.length === 0 ? (
              <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
                No line items were extracted.
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {itemDrafts.map((item, i) => {
                  const isOpen = expandedItem === i;
                  const amountNum = item.amount.trim() !== "" ? Number(item.amount) : null;
                  // Unit price isn't retained past the AI result (reviewed-from-result.ts
                  // discards it — only the line total survives into ItemDraft), so this
                  // never fabricates a "qty × unit price" reading; it falls back to plain
                  // qty. Secondary Category only — Primary ("Groceries") is deliberately
                  // never repeated here, since every item in this list already sits under
                  // that same primary category by construction, so restating it on every
                  // row adds no information.
                  const line2 = [item.qty || null, item.secondaryCategory || null].filter(Boolean).join(" • ");

                  return (
                    <div key={i}>
                      {/* Collapsed — a receipt row, not a card: typography, spacing, and the
                          shared divide-y hairline only. No accent bar, no pill/chip/badge, no
                          icon — tapping anywhere on the row (not a dedicated affordance) expands
                          it for editing and collapses whichever other row was open (single
                          expandedItem index). Name is font-semibold; amount is font-mono
                          font-bold and slightly larger — weight and size together (not an icon)
                          are what make the amount read as the dominant element. */}
                      <button
                        type="button"
                        onClick={() => setExpandedItem(isOpen ? null : i)}
                        aria-expanded={isOpen}
                        className="flex w-full flex-col gap-1.5 py-3.5 text-left"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="truncate text-[14.5px] font-semibold leading-snug">{item.description || "Untitled item"}</p>
                          <span
                            className={cn(
                              "flex-none font-mono text-[15.5px] font-bold tabular-nums",
                              amountNum !== null && amountNum < 0 && "text-destructive"
                            )}
                          >
                            {amountNum !== null ? fmt(amountNum) : "—"}
                          </span>
                        </div>
                        {line2 && <p className="truncate text-[11.5px] text-muted-foreground">{line2}</p>}
                      </button>

                      {/* Expanded — the exact same editable controls as before (same inputs,
                          same onChange/setItem calls, same CategoryPicker); only a light
                          background tint marks the editing area, not a card. ~200ms
                          grid-rows transition; motion-reduce disables it entirely. */}
                      <div
                        className="grid transition-[grid-template-rows] duration-200 ease-in-out motion-reduce:transition-none motion-reduce:duration-0"
                        style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                      >
                        <div className="overflow-hidden">
                          <div className="mb-2.5 rounded-[var(--radius-md)] bg-secondary/40 p-3.5">
                            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Item name</p>
                            <input
                              value={item.description}
                              onChange={(e) => setItem(i, { description: e.target.value })}
                              placeholder="Description"
                              className="w-full truncate bg-transparent text-[14px] font-bold outline-none placeholder:text-muted-foreground/60 focus:text-primary"
                            />

                            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                              {(item.qty || qtyIsNegative(item.qty)) && (
                                <input
                                  value={item.qty}
                                  onChange={(e) => setItem(i, { qty: e.target.value })}
                                  placeholder="Qty"
                                  className={cn(
                                    "w-16 flex-none rounded-full bg-primary/15 px-2 py-[3px] text-center font-mono text-[10.5px] font-semibold text-primary outline-none",
                                    qtyIsNegative(item.qty) && "bg-destructive/15 text-destructive"
                                  )}
                                />
                              )}
                              {!item.qty && !qtyIsNegative(item.qty) && (
                                <input
                                  value={item.qty}
                                  onChange={(e) => setItem(i, { qty: e.target.value })}
                                  placeholder="+ qty"
                                  className="w-16 flex-none rounded-full border border-dashed border-border px-2 py-[3px] text-center font-mono text-[10.5px] text-muted-foreground outline-none focus:border-primary focus:text-primary"
                                />
                              )}
                              <CategoryPicker
                                primary={item.primaryCategory}
                                secondary={item.secondaryCategory}
                                primaryOptions={withCurrent(primaryOptions, item.primaryCategory)}
                                secondaryOptions={withCurrent(subcategoriesFor(item.primaryCategory), item.secondaryCategory)}
                                onPrimaryChange={(primary) => {
                                  // Keep the subcategory only if it belongs to the new category.
                                  const keepSecondary = subcategoriesFor(primary).includes(item.secondaryCategory);
                                  setItem(i, { primaryCategory: primary, secondaryCategory: keepSecondary ? item.secondaryCategory : "" });
                                }}
                                onSecondaryChange={(secondary) => setItem(i, { secondaryCategory: secondary })}
                              />
                            </div>

                            <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Amount</p>
                              <input
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                value={item.amount}
                                onChange={(e) => setItem(i, { amount: e.target.value })}
                                placeholder="0.00"
                                className={cn(
                                  "flex-1 bg-transparent text-right font-mono text-[16px] font-bold tabular-nums outline-none",
                                  "placeholder:text-muted-foreground/60 focus:text-primary",
                                  item.amount.trim() !== "" && Number(item.amount) < 0 && "text-destructive"
                                )}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Summary card */}
          <section className="mb-5">
            <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Summary</p>
            <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4 shadow-md">
              <SummaryRow label="Items Total" value={`${currencyPrefix(headerDraft.currency)}${fmt(subtotal)}`} />
              <SummaryRow label="Discount" value={result.header.discount !== null ? `− ${currencyPrefix(headerDraft.currency)}${fmt(discount)}` : "—"} />
              <SummaryRow label="Tax" value={result.header.tax !== null ? `${currencyPrefix(headerDraft.currency)}${fmt(tax)}` : "—"} />
              <div className="mt-2.5 flex items-baseline justify-between border-t border-border pt-3">
                <span className="text-[13.5px] font-bold">Final Total</span>
                <span className="font-mono text-[17px] font-bold tabular-nums">
                  {currencyPrefix(headerDraft.currency)}
                  {fmt(grandTotal)}
                </span>
              </div>
            </div>
          </section>

          {validationErrors.length > 0 && (
            <div className="mb-2 rounded-[var(--radius-md)] border border-destructive/40 bg-card p-3">
              {validationErrors.map((msg) => (
                <p key={msg} className="text-[12px] font-semibold text-destructive">
                  {msg}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Sticky bottom action bar — always visible */}
        <div className="sticky bottom-0 mt-auto border-t border-border bg-background/95 px-5 pb-6 pt-3 backdrop-blur-md">
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
              className="flex-[1.4] rounded-[var(--radius-md)] bg-primary py-3 text-[14px] font-semibold text-primary-foreground disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const metaSelectClass = "bg-transparent text-[12.5px] font-semibold outline-none focus:text-primary";

/** A compact, chip-styled field for the header's secondary metadata row. */
function MetaPill({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-none items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5">
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/**
 * Primary → Secondary category picker (UI Phase 2 §4) — two native selects (keeps
 * exact keyboard/accessibility/mobile-picker behavior), visually stacked with a
 * connecting chevron so it reads as one hierarchical "pick a category" control rather
 * than two independent form fields.
 */
function CategoryPicker({
  primary,
  secondary,
  primaryOptions,
  secondaryOptions,
  onPrimaryChange,
  onSecondaryChange,
}: {
  primary: string;
  secondary: string;
  primaryOptions: string[];
  secondaryOptions: string[];
  onPrimaryChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-none items-center gap-1 rounded-full bg-secondary py-[3px] pl-2.5 pr-1.5">
      <select
        value={primary}
        onChange={(e) => onPrimaryChange(e.target.value)}
        className="max-w-[110px] bg-transparent text-[10.5px] font-bold text-foreground outline-none"
      >
        <option value="">Category</option>
        {primaryOptions.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <ChevronDown size={10} strokeWidth={2.5} className="flex-none text-muted-foreground" aria-hidden="true" />
      <select
        value={secondary}
        onChange={(e) => onSecondaryChange(e.target.value)}
        className="max-w-[110px] bg-transparent text-[10.5px] font-medium text-muted-foreground outline-none"
      >
        <option value="">Subcategory</option>
        {secondaryOptions.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
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
