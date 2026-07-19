"use client";

import { useState } from "react";
import { CaptureModal, type CaptureSubmitFn } from "@/components/capture/CaptureModal";

/**
 * Hosts the capture entry point (Fix 1 — smooth async submit):
 *
 *   "+" FAB → CaptureModal (collects input, then shows an in-modal processing state)
 *     → the capture is enqueued (POST /api/inbox: pages upload + queue row)
 *     → on success the modal confirms and closes itself; the user returns to their page
 *     → the AI pipeline runs in the BACKGROUND (server-side); results land in the Inbox.
 *
 * The modal now stays open until the receipt is successfully queued (or fails), so the
 * transition feels continuous. The upload is sent via XMLHttpRequest purely so we can
 * report the REAL "upload finished → preparing" transition to the modal (fetch can't).
 */
export function CaptureLauncher() {
  const [captureOpen, setCaptureOpen] = useState(false);

  const handleSubmit: CaptureSubmitFn = (submission, onPhase) =>
    new Promise<void>((resolve, reject) => {
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
          // Successfully queued — nudge the global indicator to update immediately.
          window.dispatchEvent(new CustomEvent("financeos:inbox-changed"));
          resolve();
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
