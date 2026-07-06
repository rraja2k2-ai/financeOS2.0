interface PendingReviewCardProps {
  merchant: string;
  amount: string;
  category: string;
  confidence: number;
  onVerify: () => void;
}

export function PendingReviewCard({
  merchant,
  amount,
  category,
  confidence,
  onVerify,
}: PendingReviewCardProps) {
  return (
    <div className="group relative rounded-xl bg-gradient-to-br from-background/50 to-background/30 backdrop-blur-xl border border-border p-4 hover:border-primary/20 transition-all duration-200 hover:scale-[1.02]">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <svg
            className="h-5 w-5 text-primary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h3 className="font-medium text-foreground">{merchant}</h3>
              <p className="mt-1 text-xl font-semibold text-foreground">{amount}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {category}
              </span>
              <span className="text-xs text-muted-foreground">
                {confidence}% confidence
              </span>
            </div>
          </div>

          <button
            onClick={onVerify}
            className="mt-3 w-full rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
          >
            Verify
          </button>
        </div>
      </div>
    </div>
  );
}
