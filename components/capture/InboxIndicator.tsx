"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

/**
 * The ONE small global Capture Inbox indicator (C5). Lives in the app shell, visible
 * from every page. Shown ONLY while at least one queue item has status Processing;
 * hidden automatically the moment none do. Clicking opens the Capture Inbox. No banners,
 * no interruptions.
 *
 * UX refresh Phase F: since this is the one component mounted on every page, it's also
 * the natural place to notice "a background capture just finished" (processing count
 * dropped) and broadcast the SAME `financeos:inbox-changed` event already used for
 * enqueue/retry/delete — Activity (and anything else) listens for that one event rather
 * than each page polling its own queue-status endpoint.
 *
 * Post-capture navigation (Fix 6.4.4): this is a FALLBACK for when the Capture Modal
 * isn't open to see its own capture finish (Modal owns the primary path — see
 * CaptureModal.tsx). A queue row's `transactionHeaderId` being set is the exact id
 * processQueueItem's Save step just created — never a "latest transaction" guess.
 * Whichever poller (this one or the Modal) reads it first navigates AND consumes the
 * row (`POST /api/inbox/[id]/consume`, metadata-only — never touches Storage). Tracked
 * by ID, not just a count, so an unrelated delete of an already-Failed item (which only
 * changes the total, never the Processing set) can never be mistaken for a success.
 */

const POLL_MS = 7000;

export function InboxIndicator() {
  const pathname = usePathname();
  const router = useRouter();
  const [processingCount, setProcessingCount] = useState(0);
  const prevProcessingIdsRef = useRef<Set<string>>(new Set());
  // The interval tick and the "financeos:inbox-changed" listener can both call refresh()
  // close together (e.g. right after enqueue). Without this guard, two overlapping calls
  // can both read prevProcessingIdsRef before either writes it back, double-detecting the
  // same success and pushing the same navigation twice.
  const isRefreshingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    try {
      const res = await fetch("/api/inbox", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as
        | { items?: { id: string; status: string; transactionHeaderId: string | null }[] }
        | null;
      const items = body?.items ?? [];
      // Still genuinely in flight — a saved-but-not-yet-consumed row (transactionHeaderId
      // set) no longer counts as "Processing" for the badge, even though its status
      // column hasn't changed (Fix 6.4.4 never introduces a new status value).
      const stillProcessing = items.filter((i) => i.status === "Processing" && !i.transactionHeaderId);
      const currentProcessingIds = new Set(stillProcessing.map((i) => i.id));
      const anyFinished = currentProcessingIds.size < prevProcessingIdsRef.current.size;

      prevProcessingIdsRef.current = currentProcessingIds;
      setProcessingCount(currentProcessingIds.size);

      if (anyFinished) {
        window.dispatchEvent(new CustomEvent("financeos:inbox-changed"));
      }

      // Fallback pickup: a capture finished but nothing has consumed it yet (the Modal
      // that started it isn't open anymore). Pick one per tick — normally there's only
      // one capture in flight at a time (CLAUDE.md §7).
      const readyToPickUp = items.find((i) => i.transactionHeaderId);
      if (readyToPickUp?.transactionHeaderId) {
        const headerId = readyToPickUp.transactionHeaderId;
        fetch(`/api/inbox/${readyToPickUp.id}/consume`, { method: "POST" }).catch(() => {});
        router.push(`/activity?highlight=${headerId}&edit=1`);
      }
    } catch {
      // Network hiccup — keep the previous state; next poll will correct it.
    } finally {
      isRefreshingRef.current = false;
    }
  }, [router]);

  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);

    // CaptureLauncher signals an immediate re-poll right after enqueue/retry/etc.
    function onChanged() {
      refresh();
    }
    window.addEventListener("financeos:inbox-changed", onChanged);

    return () => {
      clearInterval(t);
      window.removeEventListener("financeos:inbox-changed", onChanged);
    };
  }, [refresh]);

  if (processingCount === 0 || pathname.startsWith("/inbox")) return null;

  return (
    <Link
      href="/inbox"
      aria-label={`Capture Inbox: Processing (${processingCount})`}
      className="fixed left-4 z-50 flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-1.5 text-[11.5px] font-semibold text-muted-foreground shadow-lg backdrop-blur-md"
      style={{ bottom: "calc(96px + env(safe-area-inset-bottom, 0px))" }}
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      Processing ({processingCount})
    </Link>
  );
}
