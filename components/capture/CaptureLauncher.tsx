"use client";

import { useState } from "react";
import { CaptureModal, type CaptureSubmitFn } from "@/components/capture/CaptureModal";

/**
 * Hosts the capture entry point (Fix 6.4A — Capture screen owns the whole workflow):
 *
 *   "+" FAB → CaptureModal (collects input, then shows an in-modal processing state)
 *     → the capture is enqueued (POST /api/inbox: pages upload + queue row)
 *     → the modal STAYS OPEN and polls the queue row itself, showing "Processing receipt…"
 *       while the AI pipeline runs in the BACKGROUND (server-side) — the user never
 *       leaves not knowing whether it worked.
 *     → on success the modal navigates to Activity itself; on failure it stays open with
 *       the real error, Retry, Delete, and "Open Capture Inbox".
 *
 * The upload is sent via XMLHttpRequest purely so we can report the REAL "upload
 * finished → preparing" transition to the modal (fetch can't).
 */
export function CaptureLauncher() {
  const [captureOpen, setCaptureOpen] = useState(false);

  const handleSubmit: CaptureSubmitFn = (submission, onPhase) =>
    new Promise<{ id: string }>((resolve, reject) => {
      const form = new FormData();
      form.set("context", submission.context);
      form.set("source", submission.source);
      for (const file of submission.files) {
        form.append("pages", file, file.name);
      }

      const hasFiles = submission.files.length > 0;
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/inbox");
      xhr.timeout = 120_000;

      // Real progress: once the bytes are up, the server is storing + queueing.
      if (hasFiles && xhr.upload) {
        const markPreparing = () => onPhase("preparing");
        xhr.upload.addEventListener("load", markPreparing);
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable && e.loaded >= e.total) markPreparing();
        });
      }

      xhr.addEventListener("load", () => {
        let body: { id?: string; error?: string } | null = null;
        try {
          body = JSON.parse(xhr.responseText) as { id?: string; error?: string };
        } catch {
          body = null;
        }
        if (xhr.status >= 200 && xhr.status < 300 && body?.id) {
          // Successfully queued — nudge the global indicator to update immediately, and
          // hand the id back so the modal can poll THIS item's own processing status.
          window.dispatchEvent(new CustomEvent("financeos:inbox-changed"));
          resolve({ id: body.id });
        } else {
          reject(new Error(body?.error ?? "Couldn't add the capture to the Inbox. Please try again."));
        }
      });
      xhr.addEventListener("error", () => reject(new Error("Couldn't reach the server. Check your connection and try again.")));
      xhr.addEventListener("timeout", () => reject(new Error("Uploading took too long and was stopped. Please try again.")));

      onPhase(hasFiles ? "uploading" : "preparing");
      xhr.send(form);
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setCaptureOpen(true)}
        aria-label="Capture new transaction"
        className="fixed right-4 z-50 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95"
        style={{ bottom: "calc(96px + env(safe-area-inset-bottom, 0px))" }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {captureOpen && <CaptureModal onClose={() => setCaptureOpen(false)} onSubmit={handleSubmit} />}
    </>
  );
}
