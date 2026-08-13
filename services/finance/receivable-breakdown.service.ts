/**
 * Receivables person-wise outstanding analysis (Lending / Receivables milestone,
 * person-wise follow-up) — an Account Detail-only analytical view for a single
 * `LoanToOthers` account, exactly the same "derive on read from transaction_headers, no
 * new table" design Investment Portfolio Version 1 established
 * (investment-portfolio.service.ts). No new table, no person_id/borrower_id, no
 * per-person account — the person is, and stays, the transaction's own `merchant`.
 *
 * Reuses account-posting.service.ts's `computePostingDeltas()` per transaction (never a
 * second currency-conversion implementation) to get this ONE account's own native-currency
 * delta for each header touching it — the exact same math that built `current_balance` in
 * the first place, so summing every delta plus `unassigned` below always reconciles to
 * `current_balance` by construction, never by a separate rounding-prone recomputation.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as transactionHeaderRepository from "@/repositories/transaction-header.repository";
import { computePostingDeltas } from "./account-posting.service";
import type { Account } from "@/domain/account";
import { TRANSACTION_TYPES } from "@/constants/transaction-types";

export type PersonOutstanding = { person: string; amount: number };

export type ReceivableBreakdown = {
  currency: string;
  currentBalance: number;
  /** Sorted by amount descending; a person whose net contribution rounds to zero (fully
   *  repaid) is omitted rather than shown as a degenerate zero row. */
  byPerson: PersonOutstanding[];
  /** `currentBalance` minus the sum of `byPerson` — never a separately-tracked bucket, so
   *  it can never drift out of reconciliation with `currentBalance`. Covers an ADJUSTMENT
   *  on this account, a TRANSFER with no usable merchant (legacy data, or a manually
   *  mis-routed internal transfer), and a nonzero opening_balance — none of these have a
   *  real person to attribute to, so they are never guessed into one; they're just labeled
   *  honestly. 0 when everything reconciles to named people (the common case). */
  unassigned: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * `account` must have `account_type === "LoanToOthers"` — callers gate on that (Account
 * Detail only renders this section for a Receivable account; see AccountDetailView.tsx).
 * Not itself restricted here since the derivation is honest for any account regardless of
 * type, but a non-Receivable account has no product meaning for "outstanding by person."
 */
export async function getReceivableBreakdown(supabase: SupabaseClient, account: Account): Promise<ReceivableBreakdown> {
  const headers = await transactionHeaderRepository.listByAccountId(supabase, account.id);
  // Only this account needs a currency lookup — computePostingDeltas() naturally drops the
  // OTHER leg of a TRANSFER (its accountId won't be in this map), leaving at most one delta
  // per header: this account's own.
  const currencyById = new Map([[account.id, account.currency]]);

  const byPerson = new Map<string, number>();

  for (const header of headers) {
    const deltas = await computePostingDeltas(supabase, header, currencyById);
    const mine = deltas.find((d) => d.accountId === account.id);
    if (!mine || mine.delta === 0) continue;

    const person = header.transaction_type === TRANSACTION_TYPES.TRANSFER ? header.merchant.trim() : "";
    if (!person) continue; // falls into `unassigned` via the reconciliation residual below

    byPerson.set(person, round2((byPerson.get(person) ?? 0) + mine.delta));
  }

  const currentBalance = round2(Number(account.current_balance));
  const byPersonList = Array.from(byPerson.entries())
    .map(([person, amount]) => ({ person, amount }))
    .filter((p) => Math.round(p.amount * 100) !== 0)
    .sort((a, b) => b.amount - a.amount);

  const sumAssigned = round2(byPersonList.reduce((sum, p) => sum + p.amount, 0));

  return {
    currency: account.currency,
    currentBalance,
    byPerson: byPersonList,
    unassigned: round2(currentBalance - sumAssigned),
  };
}
