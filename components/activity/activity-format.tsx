/**
 * Shared display formatting for Activity's transaction data — extracted so
 * TransactionCard.tsx (the card) and ActivityView.tsx (the card list + its own
 * search-results view) never duplicate the same formatting logic (CLAUDE.md §8).
 * Presentation only — no calculations, no data fetching.
 */
import type { ReactNode } from "react";

export function fmt(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** "15 Jul 2026" — the receipt/business date, Activity's primary date (Fix 6.4.2). */
export function formatFullDate(dateIso: string): string {
  return new Date(dateIso + "T00:00:00").toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/** "20 Jul 2026, 8:42 PM" — the ingestion timestamp, informational only (Fix 6.4.2). */
export function formatCapturedAt(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  const timePart = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${datePart}, ${timePart}`;
}

/**
 * Qty is stored free text (Fix 5.2). Weight/volume/etc. units are shown exactly as
 * extracted — never reformatted. Only when no unit is present (a bare piece count, e.g.
 * from a legacy fixed-precision NUMERIC cast like "1.000") do we trim insignificant
 * trailing zeros and apply "PC", FinanceOS's standard default unit of measure. This is
 * presentation-only — the stored qty text is never rewritten.
 */
export function formatQty(qty: string): string {
  const trimmed = qty.trim();
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) return trimmed;
  const [, numPart, unitPart] = match;
  if (unitPart.trim()) return trimmed;
  const cleanedNum = numPart.includes(".") ? numPart.replace(/0+$/, "").replace(/\.$/, "") || "0" : numPart;
  return `${cleanedNum} PC`;
}

export function highlight(text: string | null | undefined, query: string): ReactNode {
  const safe = text ?? "";
  if (!query.trim()) return safe;
  const idx = safe.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return safe;
  return (
    <>
      {safe.slice(0, idx)}
      <mark className="rounded bg-accent px-0.5 text-accent-foreground">{safe.slice(idx, idx + query.length)}</mark>
      {safe.slice(idx + query.length)}
    </>
  );
}
