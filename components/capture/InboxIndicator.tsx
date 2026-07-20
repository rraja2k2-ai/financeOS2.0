"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
 */

const POLL_MS = 7000;

export function InboxIndicator() {
  const pathname = usePathname();
  const [processingCount, setProcessingCount] = useState(0);
  const prevCountRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as { items?: { status: string }[] } | null;
      const items = body?.items ?? [];
      const count = items.filter((i) => i.status === "Processing").length;
      if (count < prevCountRef.current) {
        window.dispatchEvent(new CustomEvent("financeos:inbox-changed"));
      }
      prevCountRef.current = count;
      setProcessingCount(count);
    } catch {
      // Network hiccup — keep the previous count; next poll will correct it.
    }
  }, []);

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
