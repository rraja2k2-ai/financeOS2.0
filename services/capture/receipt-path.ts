/**
 * Shared Storage path helpers for receipt pages — used by both the direct save path
 * (save-capture.service.ts) and the Capture Inbox enqueue path (inbox.service.ts) so the
 * "UUID folder, independent of any transaction/receipt id" rule lives in exactly one place.
 */
import { randomUUID } from "node:crypto";

/** `YYYY/MM/<uuid>` — a UUID-keyed folder, grouped by upload month, never tied to any id. */
export function receiptFolder(): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}/${mm}/${randomUUID()}`;
}

export function extForMime(mimeType: string): string {
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/heic") return ".heic";
  return ".jpg";
}
