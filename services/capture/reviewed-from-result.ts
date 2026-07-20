/**
 * Pure mapping: a raw AI extraction result -> the ReviewedCapture shape Save expects,
 * with no human edits applied. This is the ONLY place this mapping happens — the Review
 * Screen uses it to pre-populate its editable draft (client), and auto-save uses it,
 * unmodified, as the save payload itself (server, background). One mapping, two callers,
 * per CLAUDE.md's "no duplicated logic."
 */
import type { CaptureReceiptResult } from "@/services/ai/ai-provider";
import type { ReviewedCapture } from "./save-capture.service";

export function reviewedFromResult(result: CaptureReceiptResult): ReviewedCapture {
  return {
    header: {
      merchant: result.header.merchant ?? "",
      transactionDate: result.header.transactionDate ?? "",
      currency: result.header.currency ?? "",
      paymentMethod: result.header.paymentMethod ?? "",
      account: result.headerSuggestions.account ?? "",
      project: result.headerSuggestions.project ?? "",
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
    tax: result.header.tax,
    discount: result.header.discount,
  };
}
