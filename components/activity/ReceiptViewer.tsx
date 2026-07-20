"use client";

import { useEffect, useState } from "react";

export type ReceiptViewerPage = {
  url: string;
  mimeType: string;
  pageNo: number;
};

/**
 * Full-screen viewer for a saved transaction's original receipt file(s) (UX refresh
 * Phase D). Read-only — reuses the stored original untouched, no thumbnails/derived
 * copies. Same full-screen overlay pattern as ReviewScreen/CaptureModal.
 */
export function ReceiptViewer({ pages, onClose }: { pages: ReceiptViewerPage[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const page = pages[index];

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

      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        {!page ? (
          <p className="text-[13px] text-white/70">Receipt not available.</p>
        ) : page.mimeType === "application/pdf" ? (
          <iframe src={page.url} title={`Receipt page ${page.pageNo}`} className="h-full w-full rounded-lg bg-white" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimizable
          <img src={page.url} alt={`Receipt page ${page.pageNo}`} className="max-h-full max-w-full rounded-lg object-contain" />
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
    </div>
  );
}
