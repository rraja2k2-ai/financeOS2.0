"use client";

import { useState } from "react";
import { FolderKanban, Pencil, Receipt as ReceiptIcon, Wallet, X } from "lucide-react";
import { currencyPrefix } from "@/lib/currency";
import { formatCapturedAt, formatFullDate, formatQty, fmt } from "@/components/activity/activity-format";
import { categoryPath } from "@/components/activity/FilteredLineItemList";
import { formatItemQtyText } from "@/services/capture/reviewed-from-result";
import { MERCHANT_FIELD_LABELS, TRANSACTION_TYPE_LABELS, TRANSACTION_TYPES, isTransactionType } from "@/constants/transaction-types";
import { fetchReceiptPagesRequest } from "@/lib/transaction-actions";
import { ReceiptViewer, type ReceiptViewerPage } from "@/components/activity/ReceiptViewer";
import type { CaptureReceiptResult } from "@/services/ai/ai-provider";

/**
 * Transaction Details — the universal, READ-ONLY drill-down destination (Introduce
 * Transaction Details milestone). Browsing (Activity Header's "View Details", a Search
 * result, a Category Filter row) always lands here first; editing is the explicit
 * "Edit" action in the top-right, which opens the SAME shared Transaction Workspace
 * (ReviewScreen) — never a second edit implementation. This component holds no form
 * state, no drafts, no save/delete logic; it only displays `result`.
 *
 * Deliberately NOT built by adding a `readOnly` mode to ReviewScreen itself — that
 * would mean restructuring ReviewScreen's own rendering (inputs vs text everywhere),
 * which the milestone explicitly rules out ("Do NOT redesign Transaction Workspace").
 * Instead this mirrors ReviewScreen's visual structure by hand (same header shape, chip
 * row, item list, summary card) while reusing every already-shared piece that doesn't
 * require ReviewScreen's own edit machinery: activity-format's formatters,
 * FilteredLineItemList's categoryPath, reviewed-from-result's formatItemQtyText, and
 * ReceiptViewer itself.
 */
export function TransactionDetailView({
  result,
  capturedAt,
  headerId,
  onBack,
  onEdit,
}: {
  result: CaptureReceiptResult;
  /** Ingestion timestamp, informational only — same as ReviewScreen's own display. */
  capturedAt?: string;
  /** Powers the receipt-viewer button, same as ReviewScreen's — omitted only if a
   *  future caller genuinely has no saved transaction yet. */
  headerId?: string;
  /** Back — returns to exactly where the user came from (the filtered list, or the
   *  default Activity browsing view). Callers render this as an overlay, never a route
   *  change, so nothing here needs to save/restore that state itself. */
  onBack: () => void;
  /** Edit — opens the existing Transaction Workspace on this SAME already-fetched
   *  transaction. No refetch: the caller already has everything ReviewScreen needs. */
  onEdit: () => void;
}) {
  const [viewingReceipt, setViewingReceipt] = useState<ReceiptViewerPage[] | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  async function handleViewReceipt() {
    if (!headerId) return;
    setReceiptError(null);
    setReceiptLoading(true);
    const res = await fetchReceiptPagesRequest(headerId);
    if (res.ok) setViewingReceipt(res.pages);
    else setReceiptError(res.error);
    setReceiptLoading(false);
  }

  const { header, items, headerSuggestions } = result;
  const transactionType = header.transactionType && isTransactionType(header.transactionType) ? header.transactionType : TRANSACTION_TYPES.EXPENSE;
  const currency = header.currency ?? "";
  const prefix = currencyPrefix(currency);
  const subtotal = items.reduce((sum, i) => sum + (i.lineAmount ?? 0), 0);
  const tax = header.tax ?? 0;
  const discount = header.discount ?? 0;
  const total = header.total ?? subtotal + tax - discount;

  // Same rule as ReviewScreen (Transaction Type Finalization): an Internal Transfer
  // (destination resolves to one of the user's own accounts) has no counterparty to
  // show at all — source + destination already say everything.
  const isInternalTransfer = transactionType === TRANSACTION_TYPES.TRANSFER && !!headerSuggestions.destinationAccount;
  const merchantLabel = MERCHANT_FIELD_LABELS[transactionType];
  const showDestination = transactionType === TRANSACTION_TYPES.TRANSFER || transactionType === TRANSACTION_TYPES.INCOME;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-background" role="dialog" aria-modal="true" aria-label="Transaction details">
      <div className="mx-auto flex min-h-full w-full max-w-[480px] flex-col">
        <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-5 pt-5 backdrop-blur-md">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Transaction details</p>
              <p className="truncate text-[21px] font-bold leading-tight tracking-tight">
                {isInternalTransfer ? "Internal Transfer" : header.merchant?.trim() || merchantLabel}
              </p>
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
                  <ReceiptIcon size={16} strokeWidth={2.3} />
                </button>
              )}
              <button
                type="button"
                onClick={onEdit}
                aria-label="Edit transaction"
                className="flex h-9 items-center gap-1.5 rounded-xl border border-primary bg-primary/10 px-3 text-[12.5px] font-semibold text-primary"
              >
                <Pencil size={13} strokeWidth={2.3} />
                Edit
              </button>
              <button
                type="button"
                onClick={onBack}
                aria-label="Back"
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

          <div className="mb-3 font-mono text-[18px] font-bold leading-none tabular-nums">
            {prefix}
            {fmt(total)}
          </div>

          <div className="mb-4 flex items-center gap-2.5 text-[12.5px] text-muted-foreground">
            <span className="font-semibold text-foreground">{header.transactionDate ? formatFullDate(header.transactionDate) : "—"}</span>
            <span aria-hidden="true">·</span>
            <span>
              {items.length} item{items.length === 1 ? "" : "s"}
            </span>
            {capturedAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>Captured {formatCapturedAt(capturedAt)}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-4">
            <ReadPill label="Type">{TRANSACTION_TYPE_LABELS[transactionType]}</ReadPill>
            <ReadPill label="Currency">{currency || "—"}</ReadPill>
            <ReadPill label="Account" icon={<Wallet size={12} strokeWidth={2.3} />}>
              {headerSuggestions.account || "—"}
            </ReadPill>
            {showDestination && (
              <ReadPill label="Destination" icon={<Wallet size={12} strokeWidth={2.3} />}>
                {headerSuggestions.destinationAccount || "—"}
              </ReadPill>
            )}
            <ReadPill label="Project" icon={<FolderKanban size={12} strokeWidth={2.3} />}>
              {headerSuggestions.project || "—"}
            </ReadPill>
            {header.paymentMethod && <ReadPill label="Payment">{header.paymentMethod}</ReadPill>}
          </div>
        </header>

        <div className="flex-1 px-5 py-5">
          <section className="mb-5">
            <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Items · {items.length}</p>
            {items.length === 0 ? (
              <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
                No line items on this transaction.
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {items.map((item, i) => {
                  const qtyText = formatQty(formatItemQtyText(item));
                  const line2 = [qtyText || null, categoryPath(item.primaryCategory, item.secondaryCategory)].filter(Boolean).join(" • ");
                  return (
                    <div key={i} className="flex flex-col gap-1.5 py-3.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="truncate text-[14.5px] font-semibold leading-snug">{item.description || "Untitled item"}</p>
                        <span className="flex-none font-mono text-[15.5px] font-bold tabular-nums">
                          {item.lineAmount !== null ? fmt(item.lineAmount) : "—"}
                        </span>
                      </div>
                      {line2 && <p className="truncate text-[11.5px] text-muted-foreground">{line2}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="mb-5">
            <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Summary</p>
            <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4 shadow-md">
              <SummaryRow label="Items Total" value={`${prefix}${fmt(subtotal)}`} />
              {header.discount != null && <SummaryRow label="Discount" value={`−${prefix}${fmt(header.discount)}`} />}
              {header.tax != null && <SummaryRow label="Tax" value={`${prefix}${fmt(header.tax)}`} />}
              <div className="mt-2.5 flex items-baseline justify-between border-t border-border pt-3">
                <span className="text-[13.5px] font-bold">Final Total</span>
                <span className="font-mono text-[17px] font-bold tabular-nums">
                  {prefix}
                  {fmt(total)}
                </span>
              </div>
            </div>
          </section>

          {header.notes?.trim() && (
            <section className="mb-5">
              <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Notes</p>
              <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4 text-[13px] leading-relaxed text-foreground">{header.notes}</div>
            </section>
          )}
        </div>
      </div>

      {viewingReceipt && <ReceiptViewer pages={viewingReceipt} onClose={() => setViewingReceipt(null)} />}
    </div>
  );
}

/** Read-only counterpart to ReviewScreen's MetaPill — same chip shape, plain text instead of a `<select>`. */
function ReadPill({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-none items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5">
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-[12.5px] font-semibold">{children}</span>
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
