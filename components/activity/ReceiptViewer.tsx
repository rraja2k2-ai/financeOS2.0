"use client";

import { useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { setKeepAttachmentRequest } from "@/lib/transaction-actions";

export type ReceiptViewerPage = {
  id: string;
  url: string;
  mimeType: string;
  pageNo: number;
  /** Attachment Management MVP, Feature 2 — "Keep Attachment" starts OFF; toggled here,
   *  the one place a user looks at a receipt (Feature 4's single source of truth). */
  keepAttachment: boolean;
};

const MIN_SCALE = 1;
const MAX_SCALE = 3;
const DOUBLE_TAP_SCALE = 2.2;
const DOUBLE_TAP_WINDOW_MS = 300;

function touchDistance(touches: TouchList | React.TouchList): number {
  const a = touches[0];
  const b = touches[1];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Full-screen viewer for a saved transaction's original receipt file(s) (UX refresh
 * Phase D). Read-only — reuses the stored original untouched, no thumbnails/derived
 * copies. Same full-screen overlay pattern as ReviewScreen/CaptureModal.
 *
 * Lightweight Receipt Zoom (Transaction Workspace Final UX Polish) — plain CSS
 * transform + raw touch events; no gesture library, since none exists in this codebase
 * and a hand-rolled pinch/double-tap is small enough not to warrant adding one. Deliberately
 * narrow: no pan-boundary clamping, no momentum, no crop/rotate/annotate — just scale and
 * a direct-follow drag while zoomed. Resets on page change so Prev/Next never carries a
 * stale zoom level into the next page. PDFs are untouched (the browser's own PDF viewer
 * already handles zoom).
 */
export function ReceiptViewer({ pages, onClose }: { pages: ReceiptViewerPage[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  // Local copy so toggling "Keep Attachment" reflects immediately without waiting on a
  // caller refetch — the PATCH call itself is what actually persists it.
  const [keepById, setKeepById] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(pages.map((p) => [p.id, p.keepAttachment]))
  );
  const [keepBusyId, setKeepBusyId] = useState<string | null>(null);
  // Same toast pattern already used by ActivityView/DashboardView (fixed pill,
  // auto-clears after 3s) — reused here rather than introducing a new one, since the
  // toggle itself lives inside this shared viewer, not any one caller.
  const [toast, setToast] = useState<string | null>(null);
  const page = pages[index];

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function toggleKeepAttachment() {
    if (!page || keepBusyId) return;
    const next = !keepById[page.id];
    // TEMPORARY diagnostic logging (Keep Attachment flicker investigation) — remove once
    // the root cause is confirmed in the browser console against the live deployment.
    console.log("[toggleKeepAttachment] before click", { attachmentId: page.id, current: keepById[page.id], next });
    setKeepById((prev) => ({ ...prev, [page.id]: next }));
    console.log("[toggleKeepAttachment] optimistic state set", { attachmentId: page.id, optimistic: next });
    setKeepBusyId(page.id);
    const result = await setKeepAttachmentRequest(page.id, next);
    console.log("[toggleKeepAttachment] PATCH settled", { attachmentId: page.id, result });
    if (result.ok) {
      // Confirms the visual state reflects what actually persisted — the toast only
      // fires once the API call has succeeded, never on the optimistic flip alone.
      setToast(next ? "Receipt protected from cleanup." : "Receipt will be eligible for cleanup.");
      console.log("[toggleKeepAttachment] kept optimistic state (PATCH succeeded)", { attachmentId: page.id, final: next });
    } else {
      // Revert on failure — the server state is the source of truth. Now also surfaced
      // to the user (previously silent, which is what made a real failure look like an
      // unexplained "flicker" rather than a visible, understandable error).
      setKeepById((prev) => ({ ...prev, [page.id]: !next }));
      setToast(result.error);
      console.log("[toggleKeepAttachment] REVERTED — PATCH failed", { attachmentId: page.id, revertedTo: !next, error: result.error });
    }
    setKeepBusyId(null);
  }

  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const imageWrapRef = useRef<HTMLDivElement>(null);
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const lastTapAt = useRef(0);

  useEffect(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, [index]);

  function toggleZoom() {
    setScale((s) => (s > 1 ? MIN_SCALE : DOUBLE_TAP_SCALE));
    setTranslate({ x: 0, y: 0 });
  }

  // Only touchmove needs a manual, non-passive listener — preventDefault() inside a JSX
  // onTouchMove is silently ignored (React attaches touchmove passively by default), and
  // without it the browser's own page/pinch gestures fight with ours mid-gesture.
  useEffect(() => {
    const el = imageWrapRef.current;
    if (!el) return;

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2 && pinchStart.current) {
        e.preventDefault();
        const ratio = touchDistance(e.touches) / pinchStart.current.distance;
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchStart.current.scale * ratio));
        setScale(next);
        if (next === MIN_SCALE) setTranslate({ x: 0, y: 0 });
      } else if (e.touches.length === 1 && panStart.current) {
        e.preventDefault();
        const t = e.touches[0];
        setTranslate({ x: t.clientX - panStart.current.x, y: t.clientY - panStart.current.y });
      }
    }

    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, []);

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      pinchStart.current = { distance: touchDistance(e.touches), scale };
      panStart.current = null;
      return;
    }
    if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapAt.current < DOUBLE_TAP_WINDOW_MS) {
        toggleZoom();
        lastTapAt.current = 0;
      } else {
        lastTapAt.current = now;
      }
      panStart.current = scale > 1 ? { x: e.touches[0].clientX - translate.x, y: e.touches[0].clientY - translate.y } : null;
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) pinchStart.current = null;
    if (e.touches.length === 0) panStart.current = null;
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[65] flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label="Receipt">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-[13px] font-semibold text-white">
          Receipt{pages.length > 1 ? ` · Page ${index + 1} of ${pages.length}` : ""}
        </p>
        <div className="flex items-center gap-2">
          {page && (
            <button
              type="button"
              onClick={toggleKeepAttachment}
              disabled={keepBusyId === page.id}
              aria-pressed={!!keepById[page.id]}
              aria-label={keepById[page.id] ? "Keep Attachment — on, tap to turn off" : "Keep Attachment — off, tap to turn on"}
              title="Never deleted by Manual Cleanup"
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[12px] font-semibold transition-colors disabled:opacity-50",
                keepById[page.id] ? "border-amber bg-amber/25 text-amber" : "border-white/15 bg-white/10 text-white/80"
              )}
            >
              <Star size={14} strokeWidth={2.2} fill={keepById[page.id] ? "currentColor" : "none"} />
              {keepById[page.id] ? "Kept" : "Keep Attachment"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close receipt viewer"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div
        ref={imageWrapRef}
        className="flex flex-1 items-center justify-center overflow-hidden p-4"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {!page ? (
          <p className="text-[13px] text-white/70">Receipt not available.</p>
        ) : page.mimeType === "application/pdf" ? (
          <iframe src={page.url} title={`Receipt page ${page.pageNo}`} className="h-full w-full rounded-lg bg-white" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimizable
          <img
            src={page.url}
            alt={`Receipt page ${page.pageNo}`}
            onDoubleClick={toggleZoom}
            draggable={false}
            className="max-h-full max-w-full touch-none select-none rounded-lg object-contain transition-transform duration-150 ease-out"
            style={{
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              cursor: scale > 1 ? "grab" : "zoom-in",
            }}
          />
        )}
      </div>

      {pages.length > 1 && (
        <div className="flex items-center justify-center gap-3 pb-6">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            className="rounded-lg bg-white/10 px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-30"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={index === pages.length - 1}
            onClick={() => setIndex((i) => Math.min(pages.length - 1, i + 1))}
            className="rounded-lg bg-white/10 px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-30"
          >
            Next
          </button>
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
    </div>
  );
}
