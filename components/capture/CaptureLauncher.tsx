"use client";

import { useEffect, useState } from "react";
import { CaptureModal, type CaptureSubmission } from "@/components/capture/CaptureModal";

/**
 * Hosts the capture entry point (C5 — asynchronous):
 *
 *   "+" FAB → CaptureModal (input collection ONLY)
 *     → Capture & Process closes the modal immediately
 *     → the capture is enqueued (POST /api/inbox: pages upload + queue row)
 *     → the AI pipeline runs in the BACKGROUND (server-side after())
 *     → the capture appears in the Capture Inbox, where Review/Save happen.
 *
 * The user keeps using FinanceOS the whole time — no waiting on processing here.
 * The Review screen is opened from the Inbox, not from this launcher.
 */
export function CaptureLauncher() {
  const [captureOpen, setCaptureOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleSubmit(submission: CaptureSubmission) {
    // The Capture modal's only job is collecting input — close it immediately.
    setCaptureOpen(false);

    try {
      const form = new FormData();
      form.set("context", submission.context);
      form.set("source", submission.source);
      for (const file of submission.files) {
        form.append("pages", file, file.name);
      }

      const res = await fetch("/api/inbox", { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
      const body = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;

      if (!res.ok || !body?.id) {
        setError(body?.error ?? "Couldn't add the capture to the Inbox. Try again.");
      } else {
        setToast("Added to Capture Inbox — processing in the background.");
      }
    } catch (err) {
      setError(
        err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")
          ? "Uploading took too long and was stopped. Try again."
          : "Couldn't reach the server. Check your connection and try again."
      );
    } finally {
      // Signal the global indicator to re-poll now rather than waiting for its interval.
      window.dispatchEvent(new CustomEvent("financeos:inbox-changed"));
    }
  }

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

      {error && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-8" role="alertdialog" aria-label="Capture failed">
          <div className="w-full max-w-[340px] rounded-[var(--radius-lg)] border border-border bg-card p-5">
            <p className="text-[14.5px] font-bold">Couldn&apos;t queue the capture</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="mt-4 w-full rounded-lg bg-primary py-2 text-[13px] font-semibold text-primary-foreground"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed inset-x-0 z-[80] mx-auto w-fit max-w-[90%] rounded-full bg-foreground px-4 py-2.5 text-[13px] font-semibold text-background shadow-lg"
          style={{ bottom: "calc(96px + env(safe-area-inset-bottom, 0px))" }}
        >
          {toast}
        </div>
      )}
    </>
  );
}
