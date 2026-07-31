/**
 * Shared fetch calls behind a transaction's overflow-menu actions (Delete, View Receipt)
 * — previously duplicated ad hoc inside ActivityView.tsx's own handleDelete/
 * handleViewReceipt. Extracted so Dashboard's Recent Transactions menu (Transaction UX
 * Final Polish, Part 5) reuses the exact same request/response handling instead of a
 * second copy; each caller still owns its own loading/error/toast state, since that
 * varies per screen.
 */
import type { ReceiptViewerPage } from "@/components/activity/ReceiptViewer";

export type DeleteTransactionResult = { ok: true } | { ok: false; error: string };

export async function deleteTransactionRequest(id: string): Promise<DeleteTransactionResult> {
  try {
    const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? "Couldn't delete this transaction. Try again." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again." };
  }
}

export type FetchReceiptResult = { ok: true; pages: ReceiptViewerPage[] } | { ok: false; error: string };

export async function fetchReceiptPagesRequest(id: string): Promise<FetchReceiptResult> {
  try {
    const res = await fetch(`/api/transactions/${id}/receipt`);
    const body = (await res.json().catch(() => null)) as { pages?: ReceiptViewerPage[]; error?: string } | null;
    if (!res.ok || !body?.pages) {
      return { ok: false, error: body?.error ?? "Couldn't load the receipt. Try again." };
    }
    if (body.pages.length === 0) {
      return { ok: false, error: "No receipt was attached to this transaction." };
    }
    return { ok: true, pages: body.pages };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again." };
  }
}

export type SetKeepAttachmentResult = { ok: true } | { ok: false; error: string };

/** Attachment Management MVP, Feature 2 — toggles one attachment's "Keep Attachment" flag. */
export async function setKeepAttachmentRequest(attachmentId: string, keepAttachment: boolean): Promise<SetKeepAttachmentResult> {
  try {
    const res = await fetch(`/api/receipt-attachments/${attachmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepAttachment }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? "Couldn't update this attachment. Try again." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again." };
  }
}
