"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { compressImageFile } from "@/components/capture/compress-image";

/** What the modal hands to its host when the user presses Capture & Process. */
export type CaptureSubmission = {
  context: string;
  /** All pages of the single receipt, in order. */
  files: File[];
  /** How the receipt was supplied — "prompt" when there's no receipt (context only). */
  source: "camera" | "upload" | "paste" | "prompt";
};

/** Real, event-driven submission phases the host reports back so the modal can narrate progress. */
export type CaptureProgressPhase = "uploading" | "preparing";

/**
 * Submits a capture to the queue. Resolves with the new queue row's id once the receipt
 * is successfully queued in the Capture Inbox; rejects with a friendly Error message on
 * failure. `onPhase` is called on real progress transitions (e.g. when the upload
 * finishes) — never on a timer.
 */
export type CaptureSubmitFn = (
  submission: CaptureSubmission,
  onPhase: (phase: CaptureProgressPhase) => void
) => Promise<{ id: string }>;

/**
 * Premium Capture modal (Fix 6.4A: the Capture screen owns the ENTIRE workflow).
 *
 * Full-screen overlay, NOT a page: it renders above whatever page the user is on. It
 * collects the receipt (pages) + user context, then shows a real, event-driven progress
 * state IN the modal all the way through: Uploading → Preparing → Processing receipt…
 * It stays open and polls its own queued item until the background AI pipeline either
 * succeeds (it then navigates to Activity itself, on the just-created transaction) or
 * fails (it stays open with the real error, Retry, Delete, and Open Capture Inbox). It
 * NEVER closes blind right after the upload — the user always learns the outcome.
 */

// Brief on-screen confirmation of a finished step (queued / saved) before auto-advancing.
// This is a success acknowledgement, not a simulated processing delay.
const SUCCESS_HOLD_MS = 650;

// How often the modal asks "is this capture done yet?" while its own item processes in
// the background. Real polling of real state, not a simulated timer.
const PROCESSING_POLL_MS = 2000;

type ReceiptSource = "camera" | "upload" | "paste";

type ReceiptPage = {
  id: string;
  file: File;
  /** Object URL for image thumbnails; null for PDFs (icon shown instead). */
  previewUrl: string | null;
  isPdf: boolean;
};

type Receipt = {
  source: ReceiptSource;
  pages: ReceiptPage[];
};

let pageCounter = 0;

function toPage(file: File): ReceiptPage {
  const isPdf = file.type === "application/pdf";
  return {
    id: `page-${++pageCounter}`,
    file,
    previewUrl: isPdf ? null : URL.createObjectURL(file),
    isPdf,
  };
}

function releasePages(pages: ReceiptPage[]) {
  for (const p of pages) {
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
  }
}

function phaseText(phase: CaptureProgressPhase): string {
  return phase === "uploading" ? "Uploading receipt…" : "Preparing AI processing…";
}

export function CaptureModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: CaptureSubmitFn }) {
  const router = useRouter();
  const [context, setContext] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  /** A new receipt waiting for the user to confirm replacing the current one. */
  const [pendingReceipt, setPendingReceipt] = useState<Receipt | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Submission lifecycle (Fix 6.4A): submitting stays true from "Uploading…" all the way
  // through "Processing receipt…" — the modal doesn't hand off to the background until
  // the capture is actually done.
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [statusText, setStatusText] = useState("Uploading receipt…");
  // Hard failure to even enqueue the capture (network/validation) — the form stays
  // editable and Retry re-submits fresh. Distinct from processingError below.
  const [submitError, setSubmitError] = useState<string | null>(null);

  // The queued item's own id, and the real error once its BACKGROUND processing (AI call
  // or Save) fails — as opposed to submitError, which is a failure to queue at all.
  const [queueId, setQueueId] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True only once the component has actually unmounted — distinct from the polling
  // effect's own per-run `cancelled` flag, which also flips on a deliberate dependency
  // change (e.g. setSucceeded(true) re-running that effect) and must NOT be used to abort
  // the in-flight success handler itself (Fix 6.4.1 — see the polling effect below).
  const unmountedRef = useRef(false);

  // Keep latest state in refs so the unmount-only cleanup below can release object URLs
  // without re-running (and revoking live URLs) on every state change.
  const receiptRef = useRef<Receipt | null>(null);
  receiptRef.current = receipt;
  const pendingRef = useRef<Receipt | null>(null);
  pendingRef.current = pendingReceipt;

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      releasePages(receiptRef.current?.pages ?? []);
      releasePages(pendingRef.current?.pages ?? []);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // Closing is blocked while queueing/processing/succeeding (Fix 6.4A: the screen must
  // remain visible until Success or Failure) — the user can't accidentally abandon a
  // capture partway through. Once processing has actually FAILED, closing is allowed
  // again — the Failed row stays safely in the Capture Inbox for later.
  const isBusy = submitting || succeeded;
  const requestClose = useCallback(() => {
    if (isBusy) return;
    onClose();
  }, [isBusy, onClose]);

  // Escape closes (unless busy); body scroll is locked while the overlay is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") requestClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [requestClose]);

  const autosize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(140, el.scrollHeight)}px`;
  }, []);

  useEffect(() => {
    autosize();
  }, [context, autosize]);

  /** Install `next`, either directly or via the replace-confirmation dialog. */
  function installReceipt(next: Receipt) {
    setNotice(null);
    if (receipt && receipt.pages.length > 0) {
      setPendingReceipt(next);
    } else {
      setReceipt(next);
    }
  }

  // Downscaling a phone photo is fast (well under a second) but not instant — a brief
  // notice avoids the button appearing to do nothing while it runs.
  async function withCompressionNotice<T>(work: () => Promise<T>): Promise<T> {
    setNotice("Optimizing photo…");
    try {
      return await work();
    } finally {
      setNotice(null);
    }
  }

  async function handleCameraFiles(files: FileList | null) {
    const rawFile = files?.[0];
    if (!rawFile) return;
    const file = await withCompressionNotice(() => compressImageFile(rawFile));
    // One receipt, many pages: keep appending pages while the camera is the source.
    if (receipt && receipt.source === "camera") {
      setReceipt({ ...receipt, pages: [...receipt.pages, toPage(file)] });
    } else {
      installReceipt({ source: "camera", pages: [toPage(file)] });
    }
  }

  async function handleUploadFile(files: FileList | null) {
    const rawFile = files?.[0];
    if (!rawFile) return;
    if (!rawFile.type.startsWith("image/") && rawFile.type !== "application/pdf") {
      setNotice("Upload one image or one PDF.");
      return;
    }
    const file = await withCompressionNotice(() => compressImageFile(rawFile));
    installReceipt({ source: "upload", pages: [toPage(file)] });
  }

  async function handlePaste() {
    setNotice(null);
    try {
      if (navigator.clipboard && "read" in navigator.clipboard) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((t) => t.startsWith("image/"));
          if (imageType) {
            const blob = await item.getType(imageType);
            const rawFile = new File([blob], `pasted.${imageType.split("/")[1] ?? "png"}`, { type: imageType });
            const file = await withCompressionNotice(() => compressImageFile(rawFile));
            installReceipt({ source: "paste", pages: [toPage(file)] });
            return;
          }
        }
      }
      // No image on the clipboard — fall back to text, appended to the AI context.
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setContext((c) => (c.trim() ? `${c}\n${text.trim()}` : text.trim()));
        textareaRef.current?.focus();
      } else {
        setNotice("Nothing on the clipboard to paste.");
      }
    } catch {
      setNotice("Clipboard access isn't available — try Upload instead.");
    }
  }

  function confirmReplace() {
    if (!pendingReceipt) return;
    releasePages(receipt?.pages ?? []);
    setReceipt(pendingReceipt);
    setPendingReceipt(null);
  }

  function cancelReplace() {
    releasePages(pendingReceipt?.pages ?? []);
    setPendingReceipt(null);
  }

  function removePage(id: string) {
    if (!receipt) return;
    const page = receipt.pages.find((p) => p.id === id);
    if (page?.previewUrl) URL.revokeObjectURL(page.previewUrl);
    const rest = receipt.pages.filter((p) => p.id !== id);
    setReceipt(rest.length > 0 ? { ...receipt, pages: rest } : null);
  }

  const hasAttachments = (receipt?.pages.length ?? 0) > 0;
  const canCapture = hasAttachments || context.trim().length > 0;

  /**
   * Capture & Process: queue the capture, narrating real progress inside the modal, then
   * hand off to the polling effect below to track the SAME item's background processing
   * — the modal stays open and showing "Processing receipt…" until that resolves.
   */
  async function handleCapture() {
    if (!canCapture || isBusy) return;
    const submission: CaptureSubmission = {
      context: context.trim(),
      files: (receipt?.pages ?? []).map((p) => p.file),
      source: receipt?.source ?? "prompt",
    };

    setSubmitError(null);
    setProcessingError(null);
    setSubmitting(true);
    setStatusText(submission.files.length > 0 ? "Uploading receipt…" : "Preparing AI processing…");

    try {
      const { id } = await onSubmit(submission, (phase) => setStatusText(phaseText(phase)));
      // Queued successfully — the polling effect takes over from here.
      setStatusText("Processing receipt…");
      setQueueId(id);
    } catch (err) {
      setSubmitting(false);
      setSubmitError(err instanceof Error ? err.message : "Couldn't add the capture to the Inbox. Please try again.");
    }
  }

  /**
   * Polls the queued item's own status while it's being worked on in the background
   * (Fix 6.4A). Runs whenever there's a queue id and we're not already past processing —
   * this also covers "Retry", which just clears processingError and lets this effect
   * pick the same item back up.
   */
  useEffect(() => {
    if (!queueId || succeeded || processingError) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/inbox/${queueId}`, { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as { item?: { status: string; errorMessage: string | null } | null } | null;
        if (cancelled) return;
        const item = body?.item ?? null;

        if (!item) {
          // Gone — the queue never keeps a "Saved" row, so this means Save succeeded.
          // From here on we're committed to closing + navigating: setSucceeded(true) is a
          // dependency of THIS effect, so React tears it down (flipping `cancelled` above)
          // the moment this state commits — using `cancelled` past this point would abort
          // our own success handler before the auto-close timer is ever scheduled (Fix
          // 6.4.1). Only a genuine unmount should stop us now.
          window.dispatchEvent(new CustomEvent("financeos:inbox-changed"));
          setStatusText("Transaction saved!");
          setSucceeded(true);
          const latest = await fetch("/api/transactions/latest", { cache: "no-store" })
            .then((r) => r.json())
            .catch(() => null);
          if (unmountedRef.current) return;
          closeTimerRef.current = setTimeout(() => {
            onClose();
            router.push(latest?.id ? `/activity?highlight=${latest.id}` : "/activity");
          }, SUCCESS_HOLD_MS);
          return;
        }

        if (item.status === "Failed") {
          window.dispatchEvent(new CustomEvent("financeos:inbox-changed"));
          setSubmitting(false);
          setProcessingError(item.errorMessage ?? "Processing failed. Please try again.");
          return;
        }

        pollTimerRef.current = setTimeout(poll, PROCESSING_POLL_MS);
      } catch {
        // Network hiccup — keep trying rather than leaving the user stuck mid-processing.
        if (!cancelled) pollTimerRef.current = setTimeout(poll, PROCESSING_POLL_MS);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [queueId, succeeded, processingError, onClose, router]);

  /** Reruns the SAME queued item's background pipeline (no re-upload) — reuses the existing retry endpoint. */
  async function handleRetryProcessing() {
    if (!queueId || actionBusy) return;
    setActionBusy(true);
    try {
      const res = await fetch(`/api/inbox/${queueId}/retry`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { retried?: boolean; error?: string } | null;
      if (!res.ok || !body?.retried) {
        setProcessingError(body?.error ?? "Couldn't retry this capture. Please try again.");
        return;
      }
      window.dispatchEvent(new CustomEvent("financeos:inbox-changed"));
      setSubmitting(true);
      setStatusText("Processing receipt…");
      setProcessingError(null);
    } catch {
      setProcessingError("Couldn't reach the server. Please try again.");
    } finally {
      setActionBusy(false);
    }
  }

  /** Discards the failed capture (queue row + its Storage pages) and closes the modal. */
  async function handleDeleteFailedCapture() {
    if (!queueId || actionBusy) return;
    setActionBusy(true);
    try {
      const res = await fetch(`/api/inbox/${queueId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setProcessingError(body?.error ?? "Couldn't delete this capture. Please try again.");
        return;
      }
      window.dispatchEvent(new CustomEvent("financeos:inbox-changed"));
      onClose();
    } catch {
      setProcessingError("Couldn't reach the server. Please try again.");
    } finally {
      setActionBusy(false);
    }
  }

  /** Leaves the failed capture in the queue (exception handling, not the normal path) and opens the Inbox. */
  function handleOpenInbox() {
    onClose();
    router.push("/inbox");
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-background" role="dialog" aria-modal="true" aria-label="New Capture">
      <div className="mx-auto flex min-h-full max-w-[480px] flex-col px-5 pb-8 pt-5">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h1 className="text-[22px] font-bold tracking-tight">New Capture</h1>
          <button
            type="button"
            onClick={requestClose}
            disabled={isBusy}
            aria-label="Close capture"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground disabled:opacity-40"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {isBusy ? (
          <ProcessingView statusText={statusText} succeeded={succeeded} />
        ) : processingError ? (
          <ProcessingFailedView
            message={processingError}
            busy={actionBusy}
            onRetry={handleRetryProcessing}
            onDelete={handleDeleteFailedCapture}
            onOpenInbox={handleOpenInbox}
          />
        ) : (
          <>
            {/* AI context — the primary element */}
            <textarea
              ref={textareaRef}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder={"Paid using POSB.\nThailand holiday.\nNeed reimbursement."}
              className="w-full resize-none rounded-[var(--radius-lg)] border border-border bg-card p-4 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:border-primary"
              style={{ minHeight: 140 }}
            />

            {/* Secondary actions */}
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              <ActionButton label="Camera" onClick={() => cameraInputRef.current?.click()}>
                <path d="M4 8h3l2-3h6l2 3h3v12H4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
              </ActionButton>
              <ActionButton label="Upload Receipt" onClick={() => uploadInputRef.current?.click()}>
                <path d="M12 16V4m0 0 4 4m-4-4-4 4M4 20h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </ActionButton>
              <ActionButton label="Paste" onClick={handlePaste}>
                <rect x="6" y="4" width="12" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M9 4.5h6M9 9h6M9 13h6M9 17h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </ActionButton>
            </div>

            {/* Hidden inputs. Camera: one receipt, multiple pages (one shot per click). */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                handleCameraFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                handleUploadFile(e.target.files);
                e.target.value = "";
              }}
            />

            {/* Attachments — rendered only once files exist */}
            {hasAttachments && receipt && (
              <section className="mt-5">
                <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Receipt</p>
                <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
                  {receipt.pages.map((page, i) => (
                    <div key={page.id} className={cn("flex items-center gap-3 p-3", i > 0 && "border-t border-border")}>
                      {page.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- local object URL preview, next/image can't optimize it
                        <img src={page.previewUrl} alt={`Page ${i + 1}`} className="h-11 w-11 flex-none rounded-lg border border-border object-cover" />
                      ) : (
                        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-secondary text-[18px]">📄</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-semibold">Page {i + 1}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {page.isPdf ? "PDF" : "Image"} · {page.file.name}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removePage(page.id)}
                        aria-label={`Remove page ${i + 1}`}
                        className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted-foreground hover:text-destructive"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {notice && <p className="mt-3 text-[12px] text-muted-foreground">{notice}</p>}

            {/* Failure — receipt + context are preserved above; Retry re-submits, Cancel (×) closes. */}
            {submitError && (
              <div className="mt-4 rounded-[var(--radius-md)] border border-destructive/40 bg-card p-3">
                <p className="text-[12.5px] font-semibold text-destructive">{submitError}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">Your receipt and notes are safe — retry to add it to the Inbox, or close to cancel.</p>
              </div>
            )}

            {/* Capture button */}
            <div className="mt-auto pt-6">
              <button
                type="button"
                disabled={!canCapture}
                onClick={handleCapture}
                className="w-full rounded-[var(--radius-md)] bg-primary py-3 text-[14.5px] font-semibold text-primary-foreground disabled:opacity-40"
              >
                {submitError ? "Retry" : "Capture & Process"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Replace-receipt confirmation */}
      {pendingReceipt && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-8" role="alertdialog" aria-label="Replace receipt?">
          <div className="w-full max-w-[340px] rounded-[var(--radius-lg)] border border-border bg-card p-5">
            <p className="text-[14.5px] font-bold">Replace existing Receipt?</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              Only one receipt per capture. The current receipt and its {receipt?.pages.length === 1 ? "page" : "pages"} will be removed.
            </p>
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={confirmReplace}
                className="flex-1 rounded-lg bg-primary py-2 text-[13px] font-semibold text-primary-foreground"
              >
                Replace
              </button>
              <button type="button" onClick={cancelReplace} className="flex-1 rounded-lg border border-border py-2 text-[13px] font-semibold">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** In-modal processing state — a real status message, no fake percentages, no artificial delays. */
function ProcessingView({ statusText, succeeded }: { statusText: string; succeeded: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center" role="status" aria-live="polite">
      {succeeded ? (
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
      ) : (
        <svg width="40" height="40" viewBox="0 0 24 24" className="animate-spin text-primary" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M12 3a9 9 0 1 0 9 9" />
        </svg>
      )}
      <p className={cn("mt-4 text-[14.5px] font-semibold", succeeded && "text-primary")}>{statusText}</p>
      {!succeeded && <p className="mt-1 text-[12px] text-muted-foreground">This only takes a moment — hang tight.</p>}
    </div>
  );
}

/**
 * Shown when the BACKGROUND processing of an already-queued capture fails (the AI call or
 * the save itself threw) — as opposed to failing to queue at all (see submitError above).
 * The receipt and context are safe in the Capture Inbox; this is exception handling, not
 * the normal path (CLAUDE.md §5/§7).
 */
function ProcessingFailedView({
  message,
  busy,
  onRetry,
  onDelete,
  onOpenInbox,
}: {
  message: string;
  busy: boolean;
  onRetry: () => void;
  onDelete: () => void;
  onOpenInbox: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15 text-destructive">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
          <path d="M12 9v4M12 17h.01" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </div>
      <p className="mt-4 text-[14.5px] font-semibold text-destructive">Processing failed</p>
      <p className="mt-1.5 max-w-[320px] text-[12.5px] leading-relaxed text-muted-foreground">{message}</p>
      <p className="mt-1 text-[11.5px] text-muted-foreground">Your receipt is safe in the Capture Inbox.</p>

      <div className="mt-6 flex w-full max-w-[320px] flex-col gap-2.5">
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="w-full rounded-[var(--radius-md)] bg-primary py-3 text-[14.5px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={onOpenInbox}
          disabled={busy}
          className="w-full rounded-[var(--radius-md)] border border-border py-3 text-[13.5px] font-semibold disabled:opacity-50"
        >
          Open Capture Inbox
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="w-full rounded-[var(--radius-md)] py-3 text-[13.5px] font-semibold text-destructive disabled:opacity-50"
        >
          {busy ? "Working…" : "Delete"}
        </button>
      </div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-card px-2 py-3.5 text-[11.5px] font-semibold text-muted-foreground active:scale-[0.98] disabled:opacity-50"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" className="text-primary">
        {children}
      </svg>
      {label}
    </button>
  );
}
