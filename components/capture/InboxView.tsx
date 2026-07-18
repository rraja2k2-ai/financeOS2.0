"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { ReviewScreen } from "@/components/capture/ReviewScreen";
import type { CaptureQueueStatus } from "@/domain/capture-queue";
import type { CaptureMasterData, CaptureReceiptResult } from "@/services/ai/ai-provider";
import type { ReviewedCapture } from "@/services/capture/save-capture.service";

/**
 * Capture Inbox — a WORK QUEUE focused on items needing attention (UX refinement pass).
 * Every capture lives in capture_queue across its whole lifecycle (Processing → Ready for
 * Review / Failed → Saved). Saved items are never deleted automatically — they stay in
 * the queue, just hidden from the default "Active" view. Review reuses the EXISTING
 * ReviewScreen unchanged; no backend/queue-lifecycle logic changes here.
 */

export type InboxCard = {
  id: string;
  status: CaptureQueueStatus;
  merchant: string | null;
  contextSnippet: string;
  capturedAt: string;
  updatedAt: string;
  errorMessage: string | null;
  retryCount: number;
  pageCount: number;
  isPdf: boolean;
  thumbnailUrl: string | null;
  captureSource: string;
  transactionHeaderId: string | null;
  resultJson: CaptureReceiptResult | null;
};

type FilterKey = "active" | CaptureQueueStatus;

const PROCESSING_STAGES = ["Reading receipt...", "Extracting items...", "Categorising..."];

function capturedLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function sourceLabel(source: string): string {
  switch (source) {
    case "camera":
      return "Camera";
    case "upload":
      return "Upload";
    case "paste":
      return "Paste";
    default:
      return "Prompt";
  }
}

export function InboxView({
  cards,
  masterData,
  queueUnavailable,
}: {
  cards: InboxCard[];
  masterData: CaptureMasterData | null;
  queueUnavailable: boolean;
}) {
  const router = useRouter();
  const [reviewing, setReviewing] = useState<InboxCard | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("active");

  const anyProcessing = cards.some((c) => c.status === "Processing");

  // Background processing changes rows outside this page — poll while anything is active.
  useEffect(() => {
    if (!anyProcessing) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [anyProcessing, router]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Counts drive the filter chips — Active is the union of Processing/Ready/Failed.
  const counts = useMemo(() => {
    const processing = cards.filter((c) => c.status === "Processing").length;
    const ready = cards.filter((c) => c.status === "Ready for Review").length;
    const failed = cards.filter((c) => c.status === "Failed").length;
    const saved = cards.filter((c) => c.status === "Saved").length;
    return { active: processing + ready + failed, processing, ready, failed, saved };
  }, [cards]);

  const filters: { key: FilterKey; label: string; count: number }[] = [
    { key: "active", label: "Active", count: counts.active },
    { key: "Processing", label: "Processing", count: counts.processing },
    { key: "Ready for Review", label: "Ready", count: counts.ready },
    { key: "Failed", label: "Failed", count: counts.failed },
    { key: "Saved", label: "Saved", count: counts.saved },
  ];

  const visibleCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((c) => {
      // Active view = the work queue: Processing/Ready/Failed, never Saved.
      const matchesFilter = filter === "active" ? c.status !== "Saved" : c.status === filter;
      if (!matchesFilter) return false;
      if (!q) return true;
      return (c.merchant ?? "").toLowerCase().includes(q) || c.contextSnippet.toLowerCase().includes(q);
    });
  }, [cards, query, filter]);

  const isClearActiveState = filter === "active" && !query.trim() && visibleCards.length === 0 && !queueUnavailable;

  async function handleRetry(card: InboxCard) {
    setError(null);
    setBusyId(card.id);
    try {
      const res = await fetch(`/api/inbox/${card.id}/retry`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) setError(body?.error ?? "Couldn't retry this capture.");
      router.refresh();
      window.dispatchEvent(new CustomEvent("financeos:inbox-changed"));
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(card: InboxCard) {
    setError(null);
    setBusyId(card.id);
    try {
      const res = await fetch(`/api/inbox/${card.id}`, { method: "DELETE" });
      if (!res.ok) setError("Couldn't delete this capture. Try again.");
      else setToast("Capture deleted.");
      router.refresh();
      window.dispatchEvent(new CustomEvent("financeos:inbox-changed"));
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusyId(null);
      setConfirmingDeleteId(null);
    }
  }

  /**
   * Persist via the Inbox save endpoint (the receipt is already in Storage). On success:
   * show the checkmark toast, close Review automatically, refresh so the item's status
   * flips to Saved — it then disappears from Active on its own (no manual cleanup).
   */
  async function handleSave(reviewed: ReviewedCapture) {
    if (!reviewing) return;
    const res = await fetch(`/api/inbox/${reviewing.id}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewed }),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);

    const body = res ? ((await res.json().catch(() => null)) as { saved?: unknown; error?: string } | null) : null;
    if (!res || !res.ok || !body?.saved) {
      throw new Error(body?.error ?? "Couldn't save the transaction. Your review is safe — please try again.");
    }

    setReviewing(null);
    setToast("✓ Transaction saved successfully.");
    router.refresh();
    window.dispatchEvent(new CustomEvent("financeos:inbox-changed"));
  }

  return (
    <div className="px-5 pt-6 pb-8" onClick={() => setMenuOpenId(null)}>
      <h1 className="mb-1 text-[22px] font-bold tracking-tight">Capture Inbox</h1>
      <p className="mb-4 text-[12px] text-muted-foreground">Items that need your attention.</p>

      {!queueUnavailable && cards.length > 0 && (
        <>
          <div className="relative mb-2.5">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search merchant or context"
              className="w-full rounded-[var(--radius-md)] border border-border bg-card py-2.5 pl-9 pr-3 text-[13.5px] outline-none focus:border-primary"
            />
          </div>
          <div className="mb-4 flex gap-1.5 overflow-x-auto">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  "flex-none rounded-full border px-3 py-1.5 text-[11.5px] font-semibold",
                  filter === f.key ? "border-primary bg-accent text-primary" : "border-border text-muted-foreground"
                )}
              >
                {f.label} ({f.count})
              </button>
            ))}
          </div>
        </>
      )}

      {error && <p className="mb-3 text-[12px] font-semibold text-destructive">{error}</p>}

      {queueUnavailable ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
          The Capture Inbox isn&apos;t set up yet — run the capture_queue migration in Supabase.
        </div>
      ) : isClearActiveState ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-8 text-center">
          <p className="mb-2 text-[28px]">🎉</p>
          <p className="text-[13.5px] font-semibold">Inbox is clear.</p>
          <p className="mt-1 text-[12px] text-muted-foreground">No captures require your attention.</p>
        </div>
      ) : visibleCards.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
          {cards.length === 0 ? "New captures appear here while they're being processed." : "No captures match this search/filter."}
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibleCards.map((card) => (
            <div key={card.id} className="relative rounded-[var(--radius-lg)] border border-border bg-card p-3.5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start gap-3">
                {/* Receipt thumbnail */}
                {card.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimizable
                  <img src={card.thumbnailUrl} alt="Receipt" className="h-12 w-12 flex-none rounded-lg border border-border object-cover" />
                ) : (
                  <div className="flex h-12 w-12 flex-none items-center justify-center rounded-lg bg-secondary text-[18px]">
                    {card.isPdf ? "📄" : card.pageCount > 0 ? "🧾" : "📝"}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold">
                    {card.merchant ?? (card.contextSnippet || "Receipt capture")}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {sourceLabel(card.captureSource)} · {capturedLabel(card.capturedAt)}
                    {card.pageCount > 0 ? ` · ${card.pageCount} page${card.pageCount === 1 ? "" : "s"}` : ""}
                    {card.retryCount > 0 ? ` · Retried ${card.retryCount}×` : ""}
                  </p>
                  <ProgressLine card={card} />
                </div>

                <StatusChip status={card.status} />

                {/* Overflow menu — Delete lives here, not as a primary visible action. */}
                <div className="relative flex-none">
                  <button
                    type="button"
                    aria-label="More actions"
                    onClick={() => setMenuOpenId(menuOpenId === card.id ? null : card.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="5" r="1.8" />
                      <circle cx="12" cy="12" r="1.8" />
                      <circle cx="12" cy="19" r="1.8" />
                    </svg>
                  </button>
                  {menuOpenId === card.id && (
                    <div className="absolute right-0 top-8 z-10 w-40 overflow-hidden rounded-[var(--radius-md)] border border-border bg-card shadow-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpenId(null);
                          setConfirmingDeleteId(card.id);
                        }}
                        className="block w-full px-3.5 py-2.5 text-left text-[12.5px] font-semibold text-destructive"
                      >
                        {card.status === "Saved" ? "Delete from Queue" : "Delete"}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="mt-2.5 flex items-center gap-2">
                {card.status === "Ready for Review" && (
                  <button
                    type="button"
                    disabled={busyId === card.id || !masterData}
                    onClick={() => setReviewing(card)}
                    className="rounded-lg bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Review
                  </button>
                )}
                {card.status === "Failed" && (
                  <button
                    type="button"
                    disabled={busyId === card.id}
                    onClick={() => handleRetry(card)}
                    className="rounded-lg bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {busyId === card.id ? "Retrying…" : "Retry"}
                  </button>
                )}
                {card.status === "Saved" && card.transactionHeaderId && (
                  <Link
                    href={`/activity?highlight=${card.transactionHeaderId}`}
                    className="rounded-lg border border-border px-3.5 py-1.5 text-[12.5px] font-semibold"
                  >
                    View
                  </Link>
                )}

                {confirmingDeleteId === card.id && (
                  <>
                    <span className="ml-auto max-w-[160px] text-right text-[10.5px] leading-tight text-muted-foreground">
                      {card.transactionHeaderId ? "This won't delete the saved transaction." : "Delete this capture?"}
                    </span>
                    <button
                      type="button"
                      disabled={busyId === card.id}
                      onClick={() => handleDelete(card)}
                      className="rounded-lg bg-destructive px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                    >
                      {busyId === card.id ? "…" : "Confirm"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(null)}
                      className="rounded-lg border border-border px-3 py-1.5 text-[12px] font-semibold"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Review — the EXISTING Review screen, unchanged. */}
      {reviewing && reviewing.resultJson && masterData && (
        <ReviewScreen result={reviewing.resultJson} masterData={masterData} onCancel={() => setReviewing(null)} onSave={handleSave} />
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
    </div>
  );
}

/** Human-friendly progress text — never percentages. */
function ProgressLine({ card }: { card: InboxCard }) {
  const [, tick] = useState(0);

  // Re-render every few seconds while processing so the stage text advances.
  useEffect(() => {
    if (card.status !== "Processing") return;
    const t = setInterval(() => tick((n) => n + 1), 3000);
    return () => clearInterval(t);
  }, [card.status]);

  let text: string;
  let tone = "text-muted-foreground";
  if (card.status === "Uploading") {
    text = "Uploading receipt...";
  } else if (card.status === "Processing") {
    const elapsed = Date.now() - new Date(card.updatedAt).getTime();
    const stage = Math.min(Math.floor(elapsed / 6000), PROCESSING_STAGES.length - 1);
    text = PROCESSING_STAGES[Math.max(0, stage)];
  } else if (card.status === "Ready for Review") {
    text = "Ready for review";
    tone = "text-primary";
  } else if (card.status === "Saved") {
    text = "Saved to Activity";
    tone = "text-primary";
  } else {
    text = card.errorMessage ?? "Failed";
    tone = "text-destructive";
  }

  return <p className={cn("mt-0.5 truncate text-[11.5px] font-medium", tone)}>{text}</p>;
}

function StatusChip({ status }: { status: CaptureQueueStatus }) {
  const styles =
    status === "Ready for Review" || status === "Saved"
      ? "bg-primary/15 text-primary"
      : status === "Failed"
        ? "bg-destructive/15 text-destructive"
        : "bg-secondary text-muted-foreground";
  return (
    <span className={cn("mt-0.5 flex-none rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide", styles)}>
      {status === "Ready for Review" ? "Ready" : status}
    </span>
  );
}
