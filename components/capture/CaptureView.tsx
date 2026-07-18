"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type CaptureApiResult = {
  extraction: {
    merchant: string;
    transactionDate: string | null;
    currency: string;
    totalAmount: number;
    lineItems: { description: string; qty: string; itemTotal: number }[];
    warnings: string[];
    confidence: number;
  };
  classification: {
    headerPrimaryCategory: string;
    items: { primaryCategory: string; secondaryCategory: string | null }[];
  };
  accountMatch: { account: { account_name: string } | null; note: string | null };
  projectMatch: { project: { project_name: string } | null; note: string | null };
  totalCheck: { matches: boolean };
  duplicateCheck: { isDuplicate: boolean };
  warnings: string[];
  needsReview: boolean;
  saved: { header: { id: string; receipt_id: string } } | null;
  saveError: string | null;
};

type ApiError = { error: string; kind?: string; retryable?: boolean };

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function categoryPath(primary: string | null | undefined, secondary: string | null | undefined): string {
  if (primary && secondary) return `${primary} > ${secondary}`;
  return primary ?? secondary ?? "—";
}

export function CaptureView() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CaptureApiResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  function reset() {
    setFileName(null);
    setDataUrl(null);
    setFreeText("");
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submit() {
    if (!dataUrl && !freeText.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    let mimeType: string | undefined;
    let dataBase64: string | undefined;
    if (dataUrl) {
      const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        dataBase64 = match[2];
      }
    }

    try {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mimeType, dataBase64, freeText: freeText.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json as ApiError);
      } else {
        setResult(json as CaptureApiResult);
      }
    } catch (err) {
      setError({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    const { extraction, classification, accountMatch, projectMatch, saved, saveError, warnings, needsReview } = result;
    return (
      <div className="px-5 pt-6 pb-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-[22px] font-bold tracking-tight">Transaction</h1>
          <button onClick={reset} className="text-[13.5px] font-semibold text-primary">
            Capture another
          </button>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-secondary text-[20px]">🧾</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-bold">{extraction.merchant || "Unknown merchant"}</p>
              <p className="text-[12px] text-muted-foreground">{extraction.transactionDate ?? "no date"}</p>
              {saved ? (
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-primary">
                  ✓ Saved · {saved.header.receipt_id}
                </span>
              ) : saveError ? (
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2.5 py-1 text-[11px] font-bold text-destructive">
                  Not saved — {saveError}
                </span>
              ) : (
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
                  Preview only (not saved)
                </span>
              )}
              {needsReview && (
                <span className="ml-1.5 mt-2 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                  Needs review
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-baseline justify-between border-t border-border pt-3">
            <span className="text-[12px] font-semibold text-muted-foreground">Total paid</span>
            <span className="font-mono text-[20px] font-bold tabular-nums">
              {extraction.currency} {fmt(extraction.totalAmount)}
            </span>
          </div>

          <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 text-[12.5px]">
            <div className="flex justify-between"><span className="text-muted-foreground">Category</span><span className="font-semibold">{classification.headerPrimaryCategory}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Account</span><span className="font-semibold">{accountMatch.account?.account_name ?? "unmatched"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Project</span><span className="font-semibold">{projectMatch.project?.project_name ?? "unmatched"}</span></div>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-[var(--radius-md)] border border-border">
          <div className="grid grid-cols-[1fr_52px_64px] gap-2 bg-secondary px-3 py-2 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
            <span>Item</span><span className="text-center">Qty</span><span className="text-right">Amount</span>
          </div>
          {extraction.lineItems.map((item, i) => (
            <div key={i} className={cn("grid grid-cols-[1fr_52px_64px] gap-2 px-3 py-2.5 text-[12px]", i > 0 && "border-t border-border")}>
              <div className="min-w-0">
                <p className="truncate font-semibold">{item.description}</p>
                <p className="truncate text-[10.5px] text-muted-foreground">
                  {categoryPath(classification.items[i]?.primaryCategory, classification.items[i]?.secondaryCategory)}
                </p>
              </div>
              <span className="truncate text-center font-mono text-[11px] text-muted-foreground">{item.qty}</span>
              <span className="text-right font-mono font-semibold tabular-nums">{fmt(item.itemTotal)}</span>
            </div>
          ))}
        </div>

        {warnings.length > 0 && (
          <div className="mt-4 rounded-[var(--radius-md)] border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">Warnings</p>
            <ul className="space-y-1 text-[12px] text-amber-700 dark:text-amber-300">
              {warnings.map((w, i) => (
                <li key={i}>• {w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex gap-2.5">
          <Link href="/activity" className="flex-1 rounded-[var(--radius-md)] border border-border bg-card py-3 text-center text-[13.5px] font-bold">
            View in Activity
          </Link>
          <button onClick={reset} className="flex-1 rounded-[var(--radius-md)] bg-primary py-3 text-center text-[13.5px] font-bold text-primary-foreground">
            Capture another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-6 pb-8">
      <h1 className="mb-4 text-[22px] font-bold tracking-tight">New capture</h1>

      <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">Choose a source</p>
      <div className="mb-5 grid grid-cols-2 gap-2.5">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-border bg-card p-4"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
          </div>
          <span className="text-[12px] font-semibold">Camera / Upload</span>
        </button>
        <div className="flex flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] border border-dashed border-border p-4 text-center">
          <span className="truncate max-w-full text-[12px] font-semibold">{fileName ?? "No file selected"}</span>
          {dataUrl && (
            <button onClick={() => { setFileName(null); setDataUrl(null); }} className="text-[11px] text-destructive">
              Remove
            </button>
          )}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        onChange={onFileChange}
        className="hidden"
      />

      {dataUrl && dataUrl.startsWith("data:image") && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt="Selected receipt" className="mb-5 max-h-56 w-full rounded-[var(--radius-md)] border border-border object-contain" />
      )}

      <p className="mb-1.5 text-[14px] font-bold">Tell FinanceOS what happened</p>
      <p className="mb-2 text-[11.5px] text-muted-foreground">
        Free text only — works alone as a manual entry, or alongside a photo to confirm account/project.
      </p>
      <textarea
        value={freeText}
        onChange={(e) => setFreeText(e.target.value)}
        rows={3}
        placeholder={'e.g. "bought fish 500g 23 dollars using posb bank"'}
        className="mb-5 w-full rounded-[var(--radius-md)] border border-border bg-card p-3 text-[13.5px] outline-none focus:border-primary"
      />

      <button
        onClick={submit}
        disabled={loading || (!dataUrl && !freeText.trim())}
        className="w-full rounded-[var(--radius-md)] bg-primary py-3.5 text-[14.5px] font-bold text-primary-foreground disabled:opacity-40"
      >
        {loading ? "Processing…" : "Capture & process"}
      </button>

      {error && (
        <div className="mt-4 rounded-[var(--radius-md)] border border-destructive/30 bg-destructive/10 p-3 text-[12.5px] text-destructive">
          {error.kind === "quota" ? "Gemini's free daily limit is used up for today — try again tomorrow." : error.error}
        </div>
      )}
    </div>
  );
}
