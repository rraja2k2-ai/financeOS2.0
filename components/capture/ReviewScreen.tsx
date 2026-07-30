"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { FolderKanban, Receipt, Wallet, X } from "lucide-react";
import { cn, withCurrent } from "@/lib/utils";
import { currencyPrefix } from "@/lib/currency";
import { formatCapturedAt } from "@/components/activity/activity-format";
import { BASE_CURRENCIES, SUPPORTED_TARGET_CURRENCIES } from "@/domain/exchange-rate";
import type { CaptureMasterData, CaptureReceiptResult } from "@/services/ai/ai-provider";
import { merchantRequiredFor, type ReviewedCapture } from "@/services/capture/save-capture.service";
import { reviewedFromResult } from "@/services/capture/reviewed-from-result";
import { TransactionItemRow, qtyIsNegative, type ItemDraft } from "@/components/capture/TransactionItemRow";
import { ALL_TRANSACTION_TYPES, MERCHANT_FIELD_LABELS, TRANSACTION_TYPE_LABELS, TRANSACTION_TYPES, type TransactionType } from "@/constants/transaction-types";
import { fetchReceiptPagesRequest } from "@/lib/transaction-actions";
import { ReceiptViewer, type ReceiptViewerPage } from "@/components/activity/ReceiptViewer";

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
  headerId,
  itemIds,
  onCancel,
  onSave,
  onDelete,
}: {
  result: CaptureReceiptResult;
  masterData: CaptureMasterData;
  /** Ingestion timestamp, read-only display only — never editable (CLAUDE.md §7). */
  capturedAt?: string;
  /** Transaction Workspace Final UX Polish — the already-saved transaction's id, when
   *  known (every entry point that opens this screen already has one, since Review only
   *  ever opens after the transaction exists — CLAUDE.md §7). Powers the header's own
   *  receipt button below; omit only if a future caller genuinely has no saved
   *  transaction yet, in which case the button simply doesn't render. */
  headerId?: string;
  /** transaction_items ids, in the SAME order as `result.items` (every entry point loads
   *  both together — see TransactionForReview/EditingTransaction). Individual Line Item
   *  Deletion (Bug Fix) filters this in lockstep with itemDrafts on every delete, so the
   *  id handed back via onSave always matches what's actually still in itemDrafts —
   *  never the stale, original-length list that caused "Line items changed
   *  unexpectedly." */
  itemIds: string[];
  onCancel: () => void;
  /** Persist the reviewed data, alongside the surviving item ids (same length/order as
   *  `reviewed.items`, post-deletion). Resolves on success (parent closes this screen),
   *  rejects with a friendly message on failure (this screen stays open). */
  onSave: (reviewed: ReviewedCapture, itemIds: string[]) => Promise<void>;
  /** Deletes the transaction entirely. Resolves on success (parent closes this screen), rejects with a friendly message on failure (this screen stays open). */
  onDelete?: () => Promise<void>;
}) {
  const [{ header, items }] = useState(() => draftsFromResult(result));
  const [headerDraft, setHeaderDraft] = useState<HeaderDraft>(header);
  const [itemDrafts, setItemDrafts] = useState<ItemDraft[]>(items);
  const [itemIdDrafts, setItemIdDrafts] = useState<string[]>(itemIds);
  // Editable Tax and Discount (Transaction Workspace Final UX Polish) — form-friendly
  // strings, same convention as item amount/unitPrice; empty means "not specified" (saves
  // as null, matching the AI's own null when it found neither), typing "0" is a distinct,
  // deliberate zero. Persists through the exact same `tax`/`discount` ReviewedCapture
  // fields the AI result already used — no new field, no schema change.
  const [taxDraft, setTaxDraft] = useState(result.header.tax != null ? String(result.header.tax) : "");
  const [discountDraft, setDiscountDraft] = useState(result.header.discount != null ? String(result.header.discount) : "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Accessibility (Transaction Workspace Final UX Polish) — one stable base id, suffixed
   *  per metadata pill below, so each `<select>` gets a real `aria-labelledby` pointing at
   *  its own visible label instead of a screen reader announcing just the raw value with
   *  no field context. */
  const metaId = useId();
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

  // Receipt Access from Review Screen (Transaction Workspace Final UX Polish) — opens the
  // SAME ReceiptViewer/fetch used by Activity/Dashboard's "View Receipt" menu item, as an
  // overlay on top of this screen (never unmounting it), so closing the viewer returns
  // the user to exactly the edit state they left, no second receipt-viewing experience.
  const [viewingReceipt, setViewingReceipt] = useState<ReceiptViewerPage[] | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  async function handleViewReceipt() {
    if (!headerId) return;
    setReceiptError(null);
    setReceiptLoading(true);
    const result = await fetchReceiptPagesRequest(headerId);
    if (result.ok) {
      setViewingReceipt(result.pages);
    } else {
      setReceiptError(result.error);
    }
    setReceiptLoading(false);
  }

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

  /** Individual Line Item Deletion (Transaction Workspace Final UX Polish) — removes only
   *  the selected item; subtotal/grandTotal below are already derived from itemDrafts, so
   *  totals update on this same render, no extra state or refetch. expandedItem is a plain
   *  array index, so removing an earlier item shifts every later index down by one —
   *  adjusted here rather than left to silently point at the wrong row. */
  function removeItem(index: number) {
    setItemDrafts((list) => list.filter((_, i) => i !== index));
    setItemIdDrafts((list) => list.filter((_, i) => i !== index));
    setExpandedItem((current) => {
      if (current === null || current === index) return null;
      return current > index ? current - 1 : current;
    });
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

  // Live summary — recomputed from the edited amounts, including the now-editable tax/discount.
  const tax = taxDraft.trim() !== "" ? Number(taxDraft) : 0;
  const discount = discountDraft.trim() !== "" ? Number(discountDraft) : 0;
  const subtotal = itemDrafts.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const grandTotal = subtotal + tax - discount;

  // Basic client-side validation only (no server validation in C3).
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (merchantRequiredFor(headerDraft.transactionType) && !headerDraft.merchant.trim()) errors.push("Merchant cannot be empty.");
    if (itemDrafts.length === 0) errors.push("At least one line item is required.");
    if (itemDrafts.some((i) => i.amount.trim() !== "" && Number(i.amount) < 0)) errors.push("Amounts cannot be negative.");
    if (itemDrafts.some((i) => qtyIsNegative(i.qty))) errors.push("Quantities cannot be negative.");
    if (taxDraft.trim() !== "" && Number(taxDraft) < 0) errors.push("Tax cannot be negative.");
    if (discountDraft.trim() !== "" && Number(discountDraft) < 0) errors.push("Discount cannot be negative.");
    return errors;
  }, [headerDraft.merchant, headerDraft.transactionType, itemDrafts, taxDraft, discountDraft]);

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
        tax: taxDraft.trim() !== "" ? Number(taxDraft) : null,
        discount: discountDraft.trim() !== "" ? Number(discountDraft) : null,
      };
      await onSave(reviewed, itemIdDrafts);
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
            <div className="flex flex-none items-center gap-2">
              {headerId && (
                <button
                  type="button"
                  onClick={handleViewReceipt}
                  disabled={receiptLoading}
                  aria-label="View receipt"
                  title="View receipt"
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground disabled:opacity-50"
                >
                  <Receipt size={16} strokeWidth={2.3} />
                </button>
              )}
              <button
                type="button"
                onClick={onCancel}
                aria-label="Cancel review"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground"
              >
                <X size={16} strokeWidth={2.3} />
              </button>
            </div>
          </div>

          {receiptError && (
            <p className="-mt-2 mb-3 text-[12px] font-semibold text-destructive" role="alert">
              {receiptError}
            </p>
          )}

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

          {/* Compact metadata row — secondary fields, out of the way of the primary summary.
              Wrapped in a relative container so the edge-fade below can hint at
              off-screen chips (Metadata Chip Overflow Indicator) without any JS scroll
              measurement — a static gradient, not a computed one. */}
          <div className="relative -mx-5">
            <div className="flex items-center gap-2 overflow-x-auto px-5 pb-4">
              <MetaPill label="Type" labelId={`${metaId}-type`}>
                <select
                  value={headerDraft.transactionType}
                  onChange={(e) => setTransactionType(e.target.value as TransactionType)}
                  aria-labelledby={`${metaId}-type`}
                  className={metaSelectClass}
                >
                  {ALL_TRANSACTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TRANSACTION_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </MetaPill>
              <MetaPill label="Currency" labelId={`${metaId}-currency`}>
                <select
                  value={headerDraft.currency}
                  onChange={(e) => setHeader("currency", e.target.value)}
                  aria-labelledby={`${metaId}-currency`}
                  className={metaSelectClass}
                >
                  <option value="">—</option>
                  {withCurrent(CURRENCIES, headerDraft.currency).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </MetaPill>
              <MetaPill label="Account" labelId={`${metaId}-account`} icon={<Wallet size={12} strokeWidth={2.3} />}>
                <select
                  value={headerDraft.account}
                  onChange={(e) => setHeader("account", e.target.value)}
                  aria-labelledby={`${metaId}-account`}
                  className={metaSelectClass}
                >
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
                <MetaPill label="Destination" labelId={`${metaId}-destination`} icon={<Wallet size={12} strokeWidth={2.3} />}>
                  <select
                    value={headerDraft.destinationAccount}
                    onChange={(e) => setHeader("destinationAccount", e.target.value)}
                    aria-labelledby={`${metaId}-destination`}
                    className={metaSelectClass}
                  >
                    <option value="">—</option>
                    {withCurrent(masterData.accounts.map((a) => a.name), headerDraft.destinationAccount).map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </MetaPill>
              )}
              <MetaPill label="Project" labelId={`${metaId}-project`} icon={<FolderKanban size={12} strokeWidth={2.3} />}>
                <select
                  value={headerDraft.project}
                  onChange={(e) => setHeader("project", e.target.value)}
                  aria-labelledby={`${metaId}-project`}
                  className={metaSelectClass}
                >
                  <option value="">—</option>
                  {withCurrent(masterData.projects.map((p) => p.name), headerDraft.project).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </MetaPill>
            </div>
            {/* Metadata Chip Overflow Indicator — a static edge-fade, not a computed one:
                no scroll-position JS, no listener, so it costs nothing at render or scroll
                time. Hints that more chips may sit off-screen (e.g. Project on a Transfer's
                5-chip row) without measuring anything. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute bottom-4 right-0 top-0 w-8 bg-gradient-to-l from-background to-transparent"
            />
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
                    onDelete={itemDrafts.length > 1 ? () => removeItem(i) : undefined}
                    isOnlyItem={itemDrafts.length === 1}
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
              <EditableSummaryRow label="Discount" prefix={currencyPrefix(headerDraft.currency)} value={discountDraft} onChange={setDiscountDraft} sign="−" />
              <EditableSummaryRow label="Tax" prefix={currencyPrefix(headerDraft.currency)} value={taxDraft} onChange={setTaxDraft} />
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

      {/* Receipt Access from Review Screen — overlays on top (z-[65] > this screen's
          z-[60]); closing just clears local state, leaving every draft edit untouched. */}
      {viewingReceipt && <ReceiptViewer pages={viewingReceipt} onClose={() => setViewingReceipt(null)} />}
    </div>
  );
}

const metaSelectClass = "bg-transparent text-[12.5px] font-semibold outline-none focus:text-primary";

/** A compact, chip-styled field for the header's secondary metadata row. */
function MetaPill({
  label,
  labelId,
  icon,
  children,
}: {
  label: string;
  /** Accessibility — matched by the child `<select>`'s own `aria-labelledby` so a screen
   *  reader announces "Account: Fresh Mart", not just "Fresh Mart". */
  labelId: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-none items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5">
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <span id={labelId} className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
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

/** Editable Tax and Discount (Transaction Workspace Final UX Polish) — same row layout
 *  as SummaryRow, with the value replaced by an inline input. Empty is a valid, distinct
 *  state from "0" (see ReviewScreen's taxDraft/discountDraft comment). */
function EditableSummaryRow({
  label,
  prefix,
  value,
  onChange,
  sign,
}: {
  label: string;
  prefix: string;
  value: string;
  onChange: (value: string) => void;
  /** A leading sign shown before the amount (e.g. "−" for Discount) — display only, the
   *  stored value itself is never negated. */
  sign?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-1">
        {sign && value.trim() !== "" && <span className="font-mono text-[13px] font-semibold text-muted-foreground">{sign}</span>}
        <span className="font-mono text-[13px] font-semibold text-muted-foreground">{prefix}</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          aria-label={label}
          className={cn(
            "w-16 bg-transparent text-right font-mono text-[13px] font-semibold tabular-nums outline-none",
            "placeholder:text-muted-foreground/50 focus:text-primary",
            value.trim() !== "" && Number(value) < 0 && "text-destructive"
          )}
        />
      </div>
    </div>
  );
}
