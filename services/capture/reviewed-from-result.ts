/**
 * Pure mapping: a raw AI extraction result -> the ReviewedCapture shape Save expects,
 * with no human edits applied. This is the ONLY place this mapping happens — the Review
 * Screen uses it to pre-populate its editable draft (client), and auto-save uses it,
 * unmodified, as the save payload itself (server, background). One mapping, two callers,
 * per CLAUDE.md's "no duplicated logic."
 */
import type { CaptureReceiptResult } from "@/services/ai/ai-provider";
import type { ReviewedCapture } from "./save-capture.service";
import { TRANSACTION_TYPES, isTransactionType } from "@/constants/transaction-types";

export function reviewedFromResult(result: CaptureReceiptResult): ReviewedCapture {
  return {
    header: {
      merchant: result.header.merchant ?? "",
      transactionDate: result.header.transactionDate ?? "",
      currency: result.header.currency ?? "",
      paymentMethod: result.header.paymentMethod ?? "",
      account: result.headerSuggestions.account ?? "",
      project: result.headerSuggestions.project ?? "",
      destinationAccount: result.headerSuggestions.destinationAccount ?? "",
      notes: result.header.notes ?? "",
      transactionType:
        result.header.transactionType && isTransactionType(result.header.transactionType) ? result.header.transactionType : TRANSACTION_TYPES.EXPENSE,
    },
    items: result.items.map((item) => ({
      description: item.description,
      // Qty is a single free-text field combining count + unit + (when present) the
      // printed pack size — "1 bag (5 kg)", "1.356 kg", "1 bottle (2 L)" — so a bagged/
      // bottled product's size stays visible even though the Review Screen doesn't
      // render `unit`/`packSize` as their own fields yet (that's a future Receipt
      // Intelligence UI milestone, not this one).
      qty: (
        [item.qty !== null ? String(item.qty) : null, item.unit].filter(Boolean).join(" ") +
        (item.packSize ? ` (${item.packSize})` : "")
      ).trim(),
      amount: item.lineAmount !== null ? String(item.lineAmount) : "",
      primaryCategory: item.primaryCategory ?? "",
      secondaryCategory: item.secondaryCategory ?? "",
      // Receipt Intelligence Foundation fields — genuinely populated from the AI result
      // now that the contract extracts them (Gemini Receipt Intelligence Contract).
      // Still not rendered anywhere (TransactionItemRow accepts but doesn't display
      // them) — only the qty free-text above surfaces packSize, and only indirectly.
      unit: item.unit,
      packSize: item.packSize,
      unitPrice: item.unitPrice,
    })),
    tax: result.header.tax,
    discount: result.header.discount,
  };
}
