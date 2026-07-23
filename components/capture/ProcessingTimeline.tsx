import { cn } from "@/lib/utils";

/**
 * Vertical progress timeline shown while a capture is queued/processing. Step 1
 * ("Receipt Uploaded"/"Context Received") completes on a REAL signal (the upload
 * finishing, or immediately for a context-only capture). Steps 2-4 advance on an
 * elapsed-time schedule — the single Gemini call underneath has no observable
 * sub-stages (CLAUDE.md §6: one multimodal request does OCR, extraction, and
 * categorization together), so these are honestly-labeled milestones, not literal
 * progress, mirroring the same elapsed-time approach already used by the Capture
 * Inbox's own ProgressLine (components/capture/InboxView.tsx). Step 5 ("Saving
 * Transaction") only ever completes on the real "saved" signal from the parent.
 */

const STEP_LABELS = ["Reading Receipt", "Extracting Items", "Categorizing", "Saving Transaction"];

export function ProcessingTimeline({ hasReceipt, completedSteps }: { hasReceipt: boolean; completedSteps: number }) {
  const firstLabel = hasReceipt ? "Receipt Uploaded" : "Context Received";
  const labels = [firstLabel, ...STEP_LABELS];

  return (
    <div className="flex flex-1 flex-col justify-center py-10" role="status" aria-live="polite">
      <ol className="mx-auto flex w-full max-w-[280px] flex-col gap-5">
        {labels.map((label, i) => {
          const done = i < completedSteps;
          const active = i === completedSteps;
          return (
            <li key={label} className="flex items-center gap-3">
              <span
                className={cn(
                  "flex h-7 w-7 flex-none items-center justify-center rounded-full border-2 transition-colors duration-300",
                  done ? "border-primary bg-primary text-primary-foreground" : active ? "border-primary text-primary" : "border-border text-transparent"
                )}
              >
                {done ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : active ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" className="animate-spin" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <path d="M12 3a9 9 0 1 0 9 9" />
                  </svg>
                ) : null}
              </span>
              <span
                className={cn(
                  "text-[13.5px] font-semibold transition-colors duration-300",
                  done ? "text-foreground" : active ? "text-foreground" : "text-muted-foreground/60"
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
