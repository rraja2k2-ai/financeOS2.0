import { cn } from "@/lib/utils";

/** Read-only summary shown on the success card — deliberately narrow, just what the card displays. */
export type CaptureSuccessSummary = {
  merchant: string | null;
  currency: string | null;
  total: number | null;
  itemCount: number;
  transactionDate: string | null;
  account: string | null;
  category: string | null;
};

function fmtAmount(currency: string | null, total: number | null): string {
  if (total === null) return "—";
  const formatted = total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${formatted}` : formatted;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Premium post-save success card (Capture success redesign) — replaces the old
 * auto-close-and-navigate behavior. The transaction is already saved by the time this
 * renders; this is purely a calm confirmation + a choice, never a gate.
 */
export function CaptureSuccessCard({
  thumbnailUrl,
  summary,
  loading,
  error,
  onReview,
  reviewBusy,
  onDone,
}: {
  thumbnailUrl: string | null;
  summary: CaptureSuccessSummary | null;
  loading: boolean;
  error: string | null;
  onReview: () => void;
  reviewBusy: boolean;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center py-8">
      <div className="animate-in fade-in zoom-in-95 duration-300 mx-auto w-full max-w-[360px]">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <p className="mt-3 text-[15px] font-bold text-primary">Saved Successfully</p>
        </div>

        <div className="mt-5 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          {thumbnailUrl && (
            <div className="border-b border-border bg-secondary/40 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview, next/image can't optimize it */}
              <img src={thumbnailUrl} alt="Receipt" className="mx-auto h-28 w-auto rounded-md border border-border object-contain" />
            </div>
          )}

          {loading ? (
            <div className="p-5 text-center text-[12.5px] text-muted-foreground">Loading details…</div>
          ) : error ? (
            <div className="p-5 text-center text-[12.5px] text-muted-foreground">{error}</div>
          ) : summary ? (
            <div className="divide-y divide-border">
              <SummaryRow label="Merchant" value={summary.merchant ?? "—"} />
              <SummaryRow label="Total Amount" value={fmtAmount(summary.currency, summary.total)} mono />
              <SummaryRow label="Items" value={String(summary.itemCount)} />
              <SummaryRow label="Receipt Date" value={fmtDate(summary.transactionDate)} />
              <SummaryRow label="Account" value={summary.account ?? "—"} />
              <SummaryRow label="Category" value={summary.category ?? "—"} />
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onReview}
            disabled={reviewBusy}
            className="w-full rounded-[var(--radius-md)] bg-primary py-3 text-[14.5px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {reviewBusy ? "Loading…" : "Review Transaction"}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="w-full rounded-[var(--radius-md)] border border-border bg-card py-3 text-[14px] font-semibold"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span className={cn("text-[13.5px] font-semibold", mono && "font-mono tabular-nums")}>{value}</span>
    </div>
  );
}
