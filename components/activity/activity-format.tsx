/**
 * Shared display formatting for Activity's transaction data — extracted so
 * TransactionCard.tsx (the card) and ActivityView.tsx (the card list + its own
 * search-results view) never duplicate the same formatting logic (CLAUDE.md §8).
 * Presentation only — no calculations, no data fetching.
 */
import type { ReactNode } from "react";
import { TRANSACTION_TYPES, TRANSACTION_TYPE_LABELS, type TransactionType } from "@/constants/transaction-types";

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

/** id -> account_name — built once per page (Dashboard/Activity/Account Detail already
 *  load the full accounts list for their own purposes; this is a zero-extra-query
 *  reshape), reused by transactionTitle() below wherever an internal Transfer needs a
 *  destination account's NAME rather than its id (Transaction UX Final Polish, Part 8). */
export function buildAccountNameMap(accounts: { id: string; account_name: string }[]): Record<string, string> {
  return Object.fromEntries(accounts.map((a) => [a.id, a.account_name]));
}

export type TransactionTitleInput = {
  transactionType: string;
  merchant: string | null;
  sourceAccountName: string | null;
  destinationAccountName: string | null;
};

/** Bug Fix (Transfer Title Truncation) — the title is one CSS `truncate` span shared
 *  with an icon and an amount column, so a long "Source → Destination" string got cut
 *  off mid-destination-name, e.g. "POSB Bank → ICICI B...". Two-step shortening applied
 *  to each account name individually before the title is assembled, so the arrow and
 *  both sides stay legible instead of one long name silently eating the other's space:
 *  (1) drop a redundant trailing "Bank" qualifier ("POSB Bank" -> "POSB", "MariBank" and
 *  "Citi Card" are untouched since neither ends in a separate "Bank" word), (2) cap
 *  whatever remains at TRANSFER_NAME_MAX_LENGTH with its own single-character ellipsis.
 *  Display-only — never touches the stored account_name (Settings, dropdowns, etc. keep
 *  showing the full name). The title's own `truncate` class in TransactionCard stays as
 *  a last-resort safety net; with this shortening it practically never has to trigger. */
const TRANSFER_NAME_MAX_LENGTH = 14;

function shortenAccountNameForTransferTitle(name: string): string {
  const withoutGenericSuffix = name.replace(/\s+Bank$/i, "").trim() || name;
  if (withoutGenericSuffix.length <= TRANSFER_NAME_MAX_LENGTH) return withoutGenericSuffix;
  return `${withoutGenericSuffix.slice(0, TRANSFER_NAME_MAX_LENGTH - 1).trimEnd()}…`;
}

/**
 * The ONE place a transaction's display title is generated — used by TransactionCard
 * (Activity + Account Detail's Recent Transactions), Dashboard's own Recent Transactions
 * card, and the Capture success card (Transaction UX Final Polish, Part 2/3/8). Never
 * duplicated: every screen that shows a transaction title calls this function with its
 * own already-resolved account NAMES (not ids) — see buildAccountNameMap() above for the
 * id -> name step each id-based caller does first.
 */
export function transactionTitle(t: TransactionTitleInput): string {
  const merchant = t.merchant?.trim() || null;
  switch (t.transactionType) {
    case TRANSACTION_TYPES.EXPENSE:
    case TRANSACTION_TYPES.REFUND:
      return merchant ?? "Merchant";
    case TRANSACTION_TYPES.INCOME:
      return merchant ?? "Income";
    case TRANSACTION_TYPES.TRANSFER: {
      // Internal (destination resolves to one of the user's own accounts): "Source →
      // Destination". External (no destination account — merchant holds the external
      // party's name instead, see save-capture.service.ts's resolveMerchantForSave()).
      if (t.destinationAccountName) {
        const source = t.sourceAccountName ? shortenAccountNameForTransferTitle(t.sourceAccountName) : "Unknown Account";
        const destination = shortenAccountNameForTransferTitle(t.destinationAccountName);
        return `${source} → ${destination}`;
      }
      return merchant ?? "External Transfer";
    }
    case TRANSACTION_TYPES.ADJUSTMENT:
      return merchant ?? "Adjustment";
    default:
      return merchant ?? "Transaction";
  }
}

/**
 * UAT Defect Fix (Posting Engine milestone) — the subtitle line next to a card's title.
 * A non-Expense/Refund transaction's per-item category is usually just "Miscellaneous"
 * (money-movement rows have no real spending category), which reads as a misleading
 * label ("Miscellaneous · 1 item" on a bank transfer). For those types the transaction's
 * own type is the honest, identifiable subtitle instead — Expense/Refund keep showing
 * their real category, unchanged. Shared by TransactionCard (Activity + Account Detail)
 * and Dashboard's Recent Transactions category chip so the two surfaces never diverge.
 */
export function subtitleCategory(transactionType: string, primaryCategory: string | null): string | null {
  if (transactionType === TRANSACTION_TYPES.EXPENSE || transactionType === TRANSACTION_TYPES.REFUND) {
    return primaryCategory;
  }
  return TRANSACTION_TYPE_LABELS[transactionType as TransactionType] ?? primaryCategory;
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
