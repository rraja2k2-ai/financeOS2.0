"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderKanban, Wallet, X } from "lucide-react";
import { cn, withCurrent } from "@/lib/utils";
import { currencyPrefix } from "@/lib/currency";
import { formatCapturedAt } from "@/components/activity/activity-format";
import { BASE_CURRENCIES, SUPPORTED_TARGET_CURRENCIES } from "@/domain/exchange-rate";
import type { CaptureMasterData, CaptureReceiptResult } from "@/services/ai/ai-provider";
import { merchantRequiredFor, type ReviewedCapture } from "@/services/capture/save-capture.service";
import { reviewedFromResult } from "@/services/capture/reviewed-from-result";
import { TransactionItemRow, qtyIsNegative, type ItemDraft } from "@/components/capture/TransactionItemRow";
import { ALL_TRANSACTION_TYPES, MERCHANT_FIELD_LABELS, TRANSACTION_TYPE_LABELS, TRANSACTION_TYPES, type TransactionType } from "@/constants/transaction-types";

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
  transactionType: TransactionType;
  /** Transaction Type Intelligence Part 2 — only meaningful/shown for TRANSFER/INCOME. */
  destinationAccount: string;
};

const CURRENCIES: string[] = [...new Set<string>([...BASE_CURRENCIES, ...SUPPORTED_TARGET_CURRENCIES])];

/** Every transaction belongs to a project — when the AI doesn't suggest one, default to Generic. */
const DEFAULT_PROJECT = "Generic";

function draftsFromResult(result: CaptureReceiptResult): { header: HeaderDraft; items: ItemDraft[] } {
  const reviewed = reviewedFromResult(result);
  return {
    header: { ...reviewed.header, project: reviewed.header.project || DEFAULT_PROJECT },
    items: reviewed.items.map((item) => ({
      ...item,
      // Receipt Intelligence Foundation — unitPrice is numeric in ReviewedItem (the save
      // contract) but a form-friendly string here, same convention as `amount`.
      unitPrice: item.unitPrice != null ? String(item.unitPrice) : null,
    })),
  };
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ReviewScreen({
  result,
  masterData,
  capturedAt,
  onCancel,
  onSave,
  onDelete,
}: {
  result: CaptureReceiptResult;
  masterData: CaptureMasterData;
  /** Ingestion timestamp, read-only display only — never editable (CLAUDE.md §7). */
  capturedAt?: string;
  onCancel: () => void;
  /** Persist the reviewed data. Resolves on success (parent closes this screen), rejects with a friendly message on failure (this screen stays open). */
  onSave: (reviewed: ReviewedCapture) => Promise<void>;
  /** Deletes the transaction entirely. Resolves on success (parent closes this screen), rejects with a friendly message on failure (this screen stays open). */
  onDelete?: () => Promise<void>;
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

  // Delete Transaction (Transaction Workspace Foundation) — only ever available when
  // headerId/onDelete are provided, i.e. this screen is editing an already-saved
  // transaction (every entry point except a fresh in-flight Capture).
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (confirmingDelete) {
        setConfirmingDelete(false);
        return;
      }
      onCancel();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onCancel, confirmingDelete]);

  async function handleDelete() {
    if (!onDelete) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await onDelete();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Couldn't delete the transaction. Please try again.");
      setDeleting(false);
    }
  }

  function setHeader<K extends keyof Omit<HeaderDraft, "transactionType">>(key: K, value: string) {
    setHeaderDraft((h) => ({ ...h, [key]: value }));
  }

  function setTransactionType(value: TransactionType) {
    setHeaderDraft((h) => ({ ...h, transactionType: value }));
  }

  function setItem(index: number, patch: Partial<ItemDraft>) {
    setItemDrafts((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  // Transaction Type Finalization — a Transfer whose destination resolves to one of the
  // user's own accounts needs no counterparty name at all (source + destination already
  // say everything); merchant is hidden entirely and forced empty at save
  // (resolveMerchantForSave). An External Transfer (no destination account picked) still
  // shows the field, labeled "External Party", optional.
  const isInternalTransfer = headerDraft.transactionType === TRANSACTION_TYPES.TRANSFER && headerDraft.destinationAccount.trim() !== "";
  const merchantLabel = MERCHANT_FIELD_LABELS[headerDraft.transactionType];

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
    if (merchantRequiredFor(headerDraft.transactionType) && !headerDraft.merchant.trim()) errors.push("Merchant cannot be empty.");
    if (itemDrafts.length === 0) errors.push("At least one line item is required.");
    if (itemDrafts.some((i) => i.amount.trim() !== "" && Number(i.amount) < 0)) errors.push("Amounts cannot be negative.");
    if (itemDrafts.some((i) => qtyIsNegative(i.qty))) errors.push("Quantities cannot be negative.");
    return errors;
  }, [headerDraft.merchant, headerDraft.transactionType, itemDrafts]);

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
          // Receipt Intelligence Foundation — pass through unedited (no UI control
          // changes them yet); converts unitPrice back to the numeric save contract.
          unit: i.unit ?? null,
          packSize: i.packSize ?? null,
          unitPrice: i.unitPrice != null && i.unitPrice.trim() !== "" ? Number(i.unitPrice) : null,
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
              {isInternalTransfer ? (
                <p className="truncate text-[21px] font-bold leading-tight tracking-tight text-muted-foreground">Internal Transfer</p>
              ) : (
                <input
                  value={headerDraft.merchant}
                  onChange={(e) => setHeader("merchant", e.target.value)}
                  placeholder={merchantLabel}
                  aria-invalid={merchantRequiredFor(headerDraft.transactionType) && !headerDraft.merchant.trim()}
                  className={cn(
                    "w-full truncate bg-transparent text-[21px] font-bold leading-tight tracking-tight outline-none",
                    "placeholder:text-muted-foreground/60 focus:text-primary",
                    merchantRequiredFor(headerDraft.transactionType) && !headerDraft.merchant.trim() && "text-destructive"
                  )}
                />
              )}
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
            {/* Capture Date — read only, never editable (CLAUDE.md §7's "Two distinct
                dates" architecture; Transaction Workspace Foundation continues showing it
                but does not introduce editing it). */}
            {capturedAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>Captured {formatCapturedAt(capturedAt)}</span>
              </>
            )}
          </div>

          {/* Compact metadata row — secondary fields, out of the way of the primary summary. */}
          <div className="-mx-5 flex items-center gap-2 overflow-x-auto px-5 pb-4">
            <MetaPill label="Type">
              <select
                value={headerDraft.transactionType}
                onChange={(e) => setTransactionType(e.target.value as TransactionType)}
                className={metaSelectClass}
              >
                {ALL_TRANSACTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TRANSACTION_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </MetaPill>
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
            {/* Transaction Type Intelligence Part 2 — destination account only applies to
                TRANSFER/INCOME; reuses the exact same account-select markup as Account. */}
            {(headerDraft.transactionType === "TRANSFER" || headerDraft.transactionType === "INCOME") && (
              <MetaPill label="Destination" icon={<Wallet size={12} strokeWidth={2.3} />}>
                <select value={headerDraft.destinationAccount} onChange={(e) => setHeader("destinationAccount", e.target.value)} className={metaSelectClass}>
                  <option value="">—</option>
                  {withCurrent(masterData.accounts.map((a) => a.name), headerDraft.destinationAccount).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </MetaPill>
            )}
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
                {itemDrafts.map((item, i) => (
                  <TransactionItemRow
                    key={i}
                    item={item}
                    isOpen={expandedItem === i}
                    onToggle={() => setExpandedItem(expandedItem === i ? null : i)}
                    onChange={(patch) => setItem(i, patch)}
                    primaryOptions={primaryOptions}
                    secondaryOptionsFor={subcategoriesFor}
                  />
                ))}
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

          {/* Delete Transaction (Transaction Workspace Foundation) — only ever rendered
              when the host provided onDelete, i.e. this screen is editing an
              already-saved transaction, not a fresh in-flight Capture. */}
          {onDelete && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={saving}
              className="mt-2.5 w-full text-center text-[12.5px] font-semibold text-destructive disabled:opacity-50"
            >
              Delete Transaction
            </button>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmingDelete && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-8"
          role="alertdialog"
          aria-label="Delete this transaction?"
        >
          <div className="w-full max-w-[340px] rounded-[var(--radius-lg)] border border-border bg-card p-5">
            <p className="text-[14.5px] font-bold">Delete this transaction?</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">This action cannot be undone.</p>
            {deleteError && <p className="mt-2 text-[12px] font-semibold text-destructive">{deleteError}</p>}
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                className="flex-1 rounded-lg border border-border py-2 text-[13px] font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 rounded-lg bg-destructive py-2 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
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

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[13px] font-semibold tabular-nums">{value}</span>
    </div>
  );
}
