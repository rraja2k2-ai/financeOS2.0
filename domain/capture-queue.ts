/**
 * Capture Inbox queue states (Fix 5.1 — the queue is a transient processing queue, not a
 * history table). A row is either being worked on, or it failed and is waiting on retry
 * — a successful save deletes the row immediately, so no terminal "done" state exists
 * here. The underlying column's check constraint still technically permits "Uploading",
 * "Ready for Review", and "Saved" (pre-existing values from before this cleanup) — the
 * app no longer writes any of the three, so they're excluded from this type. See
 * CLAUDE.md §5.
 */
export type CaptureQueueStatus = "Processing" | "Failed";

/** How the receipt was supplied. "prompt" = context-only capture, no receipt attached. */
export type CaptureSourceKind = "camera" | "upload" | "paste" | "prompt";

/** One receipt page already uploaded to the private "receipts" Storage bucket. */
export type CaptureQueuePage = {
  storagePath: string;
  mimeType: string;
  fileSizeBytes: number;
  /** 1-based, preserves the capture's page order. */
  pageNo: number;
};

/** Row shape of the (frozen) capture_queue table. */
export type CaptureQueueItem = {
  id: string;
  status: CaptureQueueStatus;
  user_context: string;
  pages: CaptureQueuePage[];
  /** AI pipeline result (CaptureReceiptResult shape) once processing succeeded. */
  result_json: unknown | null;
  error_message: string | null;
  merchant: string | null;
  capture_source: string;
  ai_provider: string | null;
  created_at: string;
  updated_at: string;
  /** Set once Save succeeds — the transaction_headers.id this capture became. */
  transaction_header_id: string | null;
  /** Incremented on every failure and on every explicit user-initiated retry. */
  retry_count: number;
};
