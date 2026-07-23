"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { compressImageFile } from "@/components/capture/compress-image";
import { ProcessingTimeline } from "@/components/capture/ProcessingTimeline";
import { CaptureSuccessCard, type CaptureSuccessSummary } from "@/components/capture/CaptureSuccessCard";
import { ReviewScreen } from "@/components/capture/ReviewScreen";
import { watchQueueId, unwatchQueueId } from "@/lib/capture-watch";
import type { CaptureMasterData, CaptureReceiptResult } from "@/services/ai/ai-provider";
import type { ReviewedCapture } from "@/services/capture/save-capture.service";

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
 * Premium Capture modal — Capture success redesign.
 *
 * Full-screen overlay, NOT a page: it renders above whatever page the user is on. It
 * collects the receipt (pages) + user context, then shows a real, event-driven vertical
 * progress timeline all the way through queueing and background AI/Save processing (Fix
 * 6.4A — it never closes blind right after upload). Once the capture is saved, it shows
 * a calm success card (thumbnail + key fields) and lets the user choose "Review
 * Transaction" (opens the SAME shared Review/Edit screen used everywhere else) or "Done"
 * (just closes — no automatic navigation anywhere). A failed capture keeps using the
 * existing failure flow (Retry / Delete / Open Capture Inbox), unchanged.
 */

// How often the modal asks "is this capture done yet?" while its own item processes in
// the background. Real polling of real state, not a simulated timer.
const PROCESSING_POLL_MS = 2000;

// Purely visual pacing for the timeline's simulated middle steps (Reading/Extracting/
// Categorizing) — the single Gemini call has no observable sub-stages, so these are
// honestly-labeled milestones advancing on a schedule, not literal progress (see
// ProcessingTimeline's own doc comment).
const SIMULATED_STAGE_MS = 2500;

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

/** Category with the highest total spend among the saved transaction's items — display
 *  only, for the success card. Mirrors save-capture.service.ts's dominantCategory concept
 *  (same idea: highest-spend category wins) without importing that server-only module
 *  (it pulls in repositories/exchange-rate code not meant for a client bundle) — this
 *  operates on CaptureReceiptResult["items"], a different shape, purely for display. */
function dominantCategoryFromItems(items: CaptureReceiptResult["items"]): string | null {
  const byCategory = new Map<string, number>();
  for (const item of items) {
    const cat = item.primaryCategory?.trim();
    if (!cat) continue;
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + (item.lineAmount ?? 0));
  }
  let best: string | null = null;
  let bestAmount = -Infinity;
  for (const [cat, amount] of byCategory) {
    if (amount > bestAmount) {
      best = cat;
      bestAmount = amount;
    }
  }
  return best;
}

export function CaptureModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: CaptureSubmitFn }) {
  const router = useRouter();
  const [context, setContext] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  /** A new receipt waiting for the user to confirm replacing the current one. */
  const [pendingReceipt, setPendingReceipt] = useState<Receipt | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Submission lifecycle: submitting stays true from "Uploading…" all the way through
  // background processing — the modal doesn't hand off blind until the capture is
  // actually done (Fix 6.4A).
  const [submitting, setSubmitting] = useState(false);
  // Hard failure to even enqueue the capture (network/validation) — the form stays
  // editable and Retry re-submits fresh. Distinct from processingError below.
  const [submitError, setSubmitError] = useState<string | null>(null);

  // The queued item's own id, and the real error once its BACKGROUND processing (AI call
  // or Save) fails — as opposed to submitError, which is a failure to queue at all.
  const [queueId, setQueueId] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Timeline pacing: hadFiles/uploadDone drive step 1 (a real signal); queuedAt anchors
  // the elapsed-time-based simulated steps 2-4; tick forces a re-render so the elapsed
  // time is re-evaluated periodically (mirrors InboxView's own ProgressLine component).
  const [hadFiles, setHadFiles] = useState(false);
  const [uploadDone, setUploadDone] = useState(false);
  const [queuedAt, setQueuedAt] = useState<number | null>(null);
  const [, tick] = useState(0);

  // Success — the capture is saved. No auto-close, no auto-navigation: the user chooses
  // Review Transaction or Done (Capture success redesign).
  const [succeeded, setSucceeded] = useState(false);
  const [savedHeaderId, setSavedHeaderId] = useState<string | null>(null);
  const [transactionData, setTransactionData] = useState<{ result: CaptureReceiptResult; itemIds: string[] } | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Review Transaction — opens the SAME shared Review/Edit screen used everywhere else.
  // masterData is fetched lazily (only when actually requested) since the Capture Modal
  // is mounted globally, outside any page that already loaded it server-side.
  const [reviewing, setReviewing] = useState(false);
  const [masterData, setMasterData] = useState<CaptureMasterData | null>(null);
  const [masterDataLoading, setMasterDataLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep latest state in refs so the unmount-only cleanup below can release object URLs
  // without re-running (and revoking live URLs) on every state change.
  const receiptRef = useRef<Receipt | null>(null);
  receiptRef.current = receipt;
  const pendingRef = useRef<Receipt | null>(null);
  pendingRef.current = pendingReceipt;

  useEffect(() => {
    return () => {
      releasePages(receiptRef.current?.pages ?? []);
      releasePages(pendingRef.current?.pages ?? []);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // Closing is blocked only while actually queueing/processing (Fix 6.4A: the screen
  // must remain visible until Success or Failure) — once either is showing, the user can
  // dismiss freely (the transaction is already saved, or safely parked in the Inbox).
  const isBusy = submitting;
  const requestClose = useCallback(() => {
    if (isBusy) return;
    if (reviewing) {
      setReviewing(false);
      return;
    }
    onClose();
  }, [isBusy, reviewing, onClose]);

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
   * — the modal stays open and showing the processing timeline until that resolves.
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
    setHadFiles(submission.files.length > 0);
    setUploadDone(submission.files.length === 0);

    try {
      const { id } = await onSubmit(submission, (phase) => {
        if (phase === "preparing") setUploadDone(true);
      });
      // Queued successfully — the polling effect takes over from here.
      setUploadDone(true);
      setQueuedAt(Date.now());
      setQueueId(id);
    } catch (err) {
      setSubmitting(false);
      setSubmitError(err instanceof Error ? err.message : "Couldn't add the capture to the Inbox. Please try again.");
    }
  }

  // Advances the timeline's simulated middle steps by forcing a re-render on a schedule
  // while a capture is genuinely queued and processing — purely visual pacing, see
  // SIMULATED_STAGE_MS above.
  useEffect(() => {
    if (!queuedAt || succeeded || processingError) return;
    const t = setInterval(() => tick((n) => n + 1), 800);
    return () => clearInterval(t);
  }, [queuedAt, succeeded, processingError]);

  // Marks this queue row as "a Modal is open watching it" for as long as this component
  // has it, so InboxIndicator's fallback poll (a separate, slower interval) never races
  // ahead and consumes the row before this Modal's own poll gets to see it (see
  // lib/capture-watch.ts) — otherwise the Modal could find the row already gone and close
  // silently instead of showing the success card.
  useEffect(() => {
    if (!queueId) return;
    watchQueueId(queueId);
    return () => unwatchQueueId(queueId);
  }, [queueId]);

  /**
   * Polls the queued item's own status while it's being worked on in the background
   * (Fix 6.4A). Runs whenever there's a queue id and we're not already past processing —
   * this also covers "Retry", which just clears processingError and lets this effect
   * pick the same item back up.
   *
   * Success is `transactionHeaderId` being set on THIS item — the exact id
   * processQueueItem's Save step just created — never a "latest transaction" guess.
   * Capture success redesign: on success this no longer auto-closes or navigates
   * anywhere — it just flips to the success card; the user decides what happens next.
   */
  useEffect(() => {
    if (!queueId || succeeded || processingError) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/inbox/${queueId}`, { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as
          | { item?: { status: string; errorMessage: string | null; transactionHeaderId: string | null } | null }
          | null;
        if (cancelled) return;
        const item = body?.item ?? null;

        if (item?.transactionHeaderId) {
          const headerId = item.transactionHeaderId;
          window.dispatchEvent(new CustomEvent("financeos:inbox-changed"));
          fetch(`/api/inbox/${queueId}/consume`, { method: "POST" }).catch(() => {});
          setSavedHeaderId(headerId);
          setSucceeded(true);
          setSubmitting(false);
          return;
        }

        if (item?.status === "Failed") {
          window.dispatchEvent(new CustomEvent("financeos:inbox-changed"));
          setSubmitting(false);
          setProcessingError(item.errorMessage ?? "Processing failed. Please try again.");
          return;
        }

        if (!item) {
          // Gone without us ever seeing a transactionHeaderId — the global Inbox
          // indicator (or a manual delete from the Inbox page) must have already
          // consumed it. We never guess an id here — just close quietly; whichever
          // consumer got there first already handled it.
          onClose();
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
  }, [queueId, succeeded, processingError, onClose]);

  // Once saved, load the transaction's own details for the success card — a single fetch
  // reused both for the card's display AND (if the user clicks Review Transaction) as
  // ReviewScreen's own input, so nothing is fetched twice.
  useEffect(() => {
    if (!succeeded || !savedHeaderId || transactionData || summaryLoading) return;
    let cancelled = false;
    setSummaryLoading(true);
    setSummaryError(null);
    fetch(`/api/transactions/${savedHeaderId}`)
      .then(async (res) => ({ ok: res.ok, body: (await res.json().catch(() => null)) as { result?: CaptureReceiptResult; itemIds?: string[]; error?: string } | null }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok || !body?.result || !body?.itemIds) {
          setSummaryError(body?.error ?? "Couldn't load the transaction's details.");
          return;
        }
        setTransactionData({ result: body.result, itemIds: body.itemIds });
      })
      .catch(() => {
        if (!cancelled) setSummaryError("Couldn't reach the server.");
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [succeeded, savedHeaderId, transactionData, summaryLoading]);

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
      setUploadDone(true);
      setQueuedAt(Date.now());
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

  /** Loads master data (once, lazily) and opens the SAME shared Review/Edit screen on the just-saved transaction. */
  async function handleReviewTransaction() {
    if (masterDataLoading || summaryLoading || !transactionData) return;
    setReviewError(null);
    if (masterData) {
      setReviewing(true);
      return;
    }
    setMasterDataLoading(true);
    try {
      const res = await fetch("/api/capture/master-data");
      const body = (await res.json().catch(() => null)) as { masterData?: CaptureMasterData; error?: string } | null;
      if (!res.ok || !body?.masterData) {
        setReviewError(body?.error ?? "Couldn't open Review. Try again.");
        return;
      }
      setMasterData(body.masterData);
      setReviewing(true);
    } catch {
      setReviewError("Couldn't reach the server. Try again.");
    } finally {
      setMasterDataLoading(false);
    }
  }

  /** Saves Review edits back onto the SAME transaction (UPDATE, never a new one), then closes — same Edit/UPDATE path as Activity's own Edit. */
  async function handleReviewSave(reviewed: ReviewedCapture) {
    if (!savedHeaderId || !transactionData) return;
    const res = await fetch(`/api/transactions/${savedHeaderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewed, itemIds: transactionData.itemIds }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);

    const body = res ? ((await res.json().catch(() => null)) as { updated?: boolean; error?: string } | null) : null;
    if (!res || !res.ok || !body?.updated) {
      throw new Error(body?.error ?? "Couldn't save changes. Your edits are safe — please try again.");
    }

    window.dispatchEvent(new CustomEvent("financeos:inbox-changed"));
    onClose();
  }

  /** No automatic navigation anywhere — just closes, returning the user to whatever screen they were already on. */
  function handleDone() {
    onClose();
  }

  const completedSteps = !uploadDone ? 0 : !queuedAt ? 1 : 1 + Math.min(3, Math.floor((Date.now() - queuedAt) / SIMULATED_STAGE_MS));

  const cardSummary: CaptureSuccessSummary | null = transactionData
    ? {
        merchant: transactionData.result.header.merchant,
        currency: transactionData.result.header.currency,
        total: transactionData.result.header.total,
        itemCount: transactionData.result.items.length,
        transactionDate: transactionData.result.header.transactionDate,
        account: transactionData.result.headerSuggestions.account,
        category: dominantCategoryFromItems(transactionData.result.items),
      }
    : null;

  // Review Transaction — the SAME shared Review/Edit screen used everywhere else,
  // rendered on its own (not nested inside this modal's shell) so there's exactly one
  // dialog and one Escape listener active at a time.
  if (reviewing && transactionData && masterData) {
    return (
      <ReviewScreen
        result={transactionData.result}
        masterData={masterData}
        onCancel={() => setReviewing(false)}
        onSave={handleReviewSave}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-background" role="dialog" aria-modal="true" aria-label="New Capture">
      <div className="mx-auto flex min-h-full max-w-[480px] flex-col px-5 pb-8 pt-5">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h1 className="text-[22px] font-bold tracking-tight">{succeeded ? "Capture" : "New Capture"}</h1>
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
          <ProcessingTimeline hasReceipt={hadFiles} completedSteps={completedSteps} />
        ) : processingError ? (
          <ProcessingFailedView
            message={processingError}
            busy={actionBusy}
            onRetry={handleRetryProcessing}
            onDelete={handleDeleteFailedCapture}
            onOpenInbox={handleOpenInbox}
          />
        ) : succeeded ? (
          <>
            <CaptureSuccessCard
              thumbnailUrl={receipt?.pages[0]?.previewUrl ?? null}
              summary={cardSummary}
              loading={summaryLoading}
              error={summaryError}
              onReview={handleReviewTransaction}
              reviewBusy={masterDataLoading || summaryLoading || !transactionData}
              onDone={handleDone}
            />
            {reviewError && <p className="mt-1 text-center text-[12px] font-semibold text-destructive">{reviewError}</p>}
          </>
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

/**
 * Shown when the BACKGROUND processing of an already-queued capture fails (the AI call or
 * the save itself threw) — as opposed to failing to queue at all (see submitError above).
 * The receipt and context are safe in the Capture Inbox; this is exception handling, not
 * the normal path (CLAUDE.md §5/§7). Unchanged by the Capture success redesign.
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
