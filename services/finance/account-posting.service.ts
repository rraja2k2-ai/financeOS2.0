/**
 * Account Posting Engine — the ONE place account balances are ever mutated in response
 * to a transaction being created, edited, or deleted. Not a general ledger, not journal
 * entries, not double-entry accounting: `accounts.current_balance` is a simple stored
 * field (set once at account creation, per account-management.service.ts) and this
 * engine just increments/decrements it, atomically, via migration 019's
 * apply_account_balance_deltas RPC.
 *
 * Called from services/transaction.service.ts's createTransaction/updateTransaction/
 * deleteTransaction (the one choke point every save/edit/delete already funnels
 * through) and save-capture.service.ts's compensation-insert fallback. Never called
 * directly from a component, route, or repository.
 *
 * Posting rules (one per transaction_type, derived from the already-saved header —
 * never re-interprets merchant/AI output, only type + source/target account ids +
 * sgd_total_amount):
 *   EXPENSE    -> source  −amount
 *   INCOME     -> target  +amount (source ignored even if the AI populated it — a
 *                 known Milestone 2 quirk; posting only the destination avoids a
 *                 phantom debit)
 *   REFUND     -> source  +amount (reverses a prior Expense)
 *   TRANSFER   -> source −amount, target +amount (external Transfer has no target —
 *                 no Receivable/Payable account type exists to post the other side to)
 *   ADJUSTMENT -> source ±amount, SIGNED by the header's own sgd_total_amount (Master
 *                 Data & Account Management Refactor, Decision 2). Every other type here
 *                 is unsigned by construction — EXPENSE always debits, INCOME always
 *                 credits — but ADJUSTMENT's whole purpose is an arbitrary correction in
 *                 either direction, so its sign IS the semantic content. Only the
 *                 system-generated Correct Balance flow (balance-correction.service.ts)
 *                 ever produces a negative sgd_total_amount; ordinary Capture/Review
 *                 amounts stay non-negative (validateForType), unaffected by this.
 *
 * Every delta is computed in the AFFECTED account's own currency (converting the
 * header's sgd_total_amount via exchange.service.ts's existing rate table, reversed) —
 * this is what makes a same-currency and a cross-currency Transfer the same code path.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as accountRepository from "@/repositories/account.repository";
import { convertFromBaseCurrency, ExchangeRateNotFoundError } from "./exchange.service";
import { TRANSACTION_TYPES } from "@/constants/transaction-types";

export type PostingHeader = {
  transaction_type: string;
  source_account_id: string | null;
  target_account_id: string | null;
  sgd_total_amount: string | number;
};

export type PostingDelta = { accountId: string; delta: number };

async function deltaForAccount(
  supabase: SupabaseClient,
  accountId: string,
  currencyById: Map<string, string>,
  sgdAmount: number,
  sign: 1 | -1
): Promise<PostingDelta | null> {
  const currency = currencyById.get(accountId);
  if (!currency) return null; // account no longer exists (e.g. deleted) — nothing to post
  const nativeAmount = await convertFromBaseCurrency(supabase, sgdAmount, currency);
  return { accountId, delta: round2(sign * nativeAmount) };
}

/** The one per-type rule table described above. */
export async function computePostingDeltas(
  supabase: SupabaseClient,
  header: PostingHeader,
  currencyById: Map<string, string>
): Promise<PostingDelta[]> {
  const rawSgdAmount = Number(header.sgd_total_amount);
  const sgdAmount = Math.abs(rawSgdAmount);
  if (sgdAmount === 0) return [];

  const deltas: PostingDelta[] = [];
  const push = async (accountId: string | null, sign: 1 | -1) => {
    if (!accountId) return;
    const d = await deltaForAccount(supabase, accountId, currencyById, sgdAmount, sign);
    if (d) deltas.push(d);
  };

  switch (header.transaction_type) {
    case TRANSACTION_TYPES.EXPENSE:
      await push(header.source_account_id, -1);
      break;
    case TRANSACTION_TYPES.INCOME:
      await push(header.target_account_id, 1);
      break;
    case TRANSACTION_TYPES.REFUND:
      await push(header.source_account_id, 1);
      break;
    case TRANSACTION_TYPES.TRANSFER:
      await push(header.source_account_id, -1);
      await push(header.target_account_id, 1);
      break;
    case TRANSACTION_TYPES.ADJUSTMENT:
      await push(header.source_account_id, rawSgdAmount >= 0 ? 1 : -1);
      break;
    default:
      break;
  }
  return deltas;
}

function netDeltas(deltas: PostingDelta[]): PostingDelta[] {
  const byAccount = new Map<string, number>();
  for (const d of deltas) byAccount.set(d.accountId, round2((byAccount.get(d.accountId) ?? 0) + d.delta));
  return Array.from(byAccount.entries())
    .map(([accountId, delta]) => ({ accountId, delta }))
    .filter((d) => Math.round(d.delta * 100) !== 0);
}

/**
 * Posts `newHeader` and/or reverses `oldHeader`, netted into ONE atomic apply per
 * account — an Edit's reversal-then-reapply on the same account never passes through a
 * visible intermediate balance. Pass `oldHeader: null` for a fresh create; pass
 * `newHeader: null` for a delete (reversal only).
 */
export async function postTransaction(supabase: SupabaseClient, newHeader: PostingHeader | null, oldHeader: PostingHeader | null): Promise<void> {
  if (!newHeader && !oldHeader) return;

  const accounts = await accountRepository.list(supabase);
  const currencyById = new Map(accounts.map((a) => [a.id, a.currency]));

  const reversal = oldHeader ? (await computePostingDeltas(supabase, oldHeader, currencyById)).map((d) => ({ ...d, delta: -d.delta })) : [];
  const forward = newHeader ? await computePostingDeltas(supabase, newHeader, currencyById) : [];

  const netted = netDeltas([...reversal, ...forward]);
  if (netted.length === 0) return;

  await accountRepository.applyBalanceDeltas(supabase, netted);
}

/**
 * Never throws — a posting failure (e.g. a missing exchange rate for a cross-currency
 * leg) must not undo an already-successful transaction save/edit/delete. Since
 * applyBalanceDeltas is one atomic statement, a failure here means NOTHING was posted
 * (never a partial post) — logged for visibility, not silently swallowed.
 */
export async function postTransactionSafely(supabase: SupabaseClient, newHeader: PostingHeader | null, oldHeader: PostingHeader | null): Promise<void> {
  try {
    await postTransaction(supabase, newHeader, oldHeader);
  } catch (err) {
    const reason = err instanceof ExchangeRateNotFoundError ? err.message : err instanceof Error ? err.message : String(err);
    console.error("[account-posting] failed to post account balances:", reason);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
