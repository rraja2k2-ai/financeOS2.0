/** Capture Inbox queue states — mutually exclusive (C5). Frozen schema: use only these 5 values. */
export type CaptureQueueStatus = "Uploading" | "Processing" | "Ready for Review" | "Failed" | "Saved";

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
