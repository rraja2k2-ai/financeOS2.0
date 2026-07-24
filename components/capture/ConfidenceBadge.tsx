/**
 * Reusable "this extraction may need a second look" badge — future-ready only (per Fix
 * request). No confidence-scoring logic exists yet anywhere in the app; this component
 * takes a variant directly and renders it, so a future pass can wire it to
 * CaptureReceiptResult.other.confidence (or any other signal) without touching this file
 * or the success screen's layout.
 */
export type ConfidenceVariant = "needs-review" | "review-recommended";

const COPY: Record<ConfidenceVariant, string> = {
  "needs-review": "Needs Review",
  "review-recommended": "Review Recommended",
};

export function ConfidenceBadge({ variant, className }: { variant: ConfidenceVariant; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11.5px] font-semibold text-amber-500 ${className ?? ""}`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0Z" />
      </svg>
      {COPY[variant]}
    </span>
  );
}
