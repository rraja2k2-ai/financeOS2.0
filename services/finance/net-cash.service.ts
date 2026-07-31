/**
 * Net cash position (TAD-004 §3 Finance Services) — powers Dashboard's Net Cash card
 * (Dashboard v1.5: Cash / Loans / Credit Cards tabs; formerly Today's Pulse's single
 * blended figure).
 *
 * Dashboard v1.5 restructured this module's internal processing order — Option A from
 * the pre-implementation architecture review, extending this file rather than
 * introducing a new aggregation service:
 *
 *   1. Group by account type (Savings / CreditCard / LoanToOthers) — never blended
 *      before grouping, so each type's own byCurrency/total survives all the way to
 *      the return value for its own tab.
 *   2. Group each type's accounts by currency.
 *   3. Convert currency — exactly ONCE per DISTINCT currency across all three type
 *      buckets combined (never per account, never per type-currency pair), so a
 *      currency held by more than one type (e.g. SGD as both cash and credit card
 *      debt) is only ever looked up once. The resulting rate is then applied locally,
 *      via the same amount/rate formula convertToBaseCurrency itself uses, to each
 *      bucket's own native total — no further queries.
 *   4. Produce totals — pure in-memory arithmetic from step 3's rates.
 *
 * `overallNetCash` preserves the exact pre-v1.5 "net cash" semantics: Savings +
 * CreditCard only (credit balances are already negative in the data, so they net out
 * correctly). LoanToOthers are receivable trackers, not held cash (TAD-007 §4 Tier 2) —
 * never folded into overallNetCash, though v1.5 now also totals them for their own tab.
 * Investment is excluded entirely — that value belongs to the Investment screen, not
 * cash position (out of scope for this milestone, per the v1.5 spec).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account } from "@/domain/account";
import { convertToBaseCurrency, ExchangeRateNotFoundError } from "./exchange.service";

export type CurrencyBalance = {
  currency: string;
  nativeAmount: number;
};

export type NetCashBucket = {
  /** SGD-converted total for this account type. */
  total: number;
  /** Native-currency breakdown for this account type. */
  byCurrency: CurrencyBalance[];
  /** Active account count for this type — powers each tab's compact summary. */
  accountCount: number;
};

export type NetCashPosition = {
  /** Savings + CreditCard only — the same figure previously called `sgdTotal`. */
  overallNetCash: number;
  cash: NetCashBucket;
  loans: NetCashBucket;
  creditCards: NetCashBucket;
  /** Currencies that couldn't be converted (no exchange_rates row yet) — excluded from
   *  every total above, not silently dropped. */
  unconvertedCurrencies: string[];
};

export async function getNetCashPosition(supabase: SupabaseClient, accounts: Account[]): Promise<NetCashPosition> {
  const active = accounts.filter((a) => a.status === "Active");

  // 1. Group by account type.
  const savingsAccounts = active.filter((a) => a.account_type === "Savings");
  const creditCardAccounts = active.filter((a) => a.account_type === "CreditCard");
  const loanAccounts = active.filter((a) => a.account_type === "LoanToOthers");

  // 2. Group by currency, within each type.
  const cashByCurrency = groupByCurrency(savingsAccounts);
  const creditCardsByCurrency = groupByCurrency(creditCardAccounts);
  const loansByCurrency = groupByCurrency(loanAccounts);

  // 3. Convert currency — one lookup per distinct currency across all three buckets.
  const distinctCurrencies = new Set([...cashByCurrency, ...creditCardsByCurrency, ...loansByCurrency].map((b) => b.currency));
  const rateByCurrency = new Map<string, number | null>();
  const unconvertedCurrencies: string[] = [];

  // A missing exchange rate is a hard stop for a SAVE (you can't persist an unknown
  // SGD amount on a real financial record) but that's the wrong behavior for a
  // read-only rollup — one missing rate shouldn't 500 the whole Dashboard. Here we
  // skip that currency's contribution and surface it explicitly instead.
  for (const currency of distinctCurrencies) {
    try {
      // Amount is nominal (1) — only `exchangeRate` is used; every bucket's own
      // native amount in this currency is converted locally below, off this ONE rate.
      const { exchangeRate } = await convertToBaseCurrency(supabase, 1, currency);
      rateByCurrency.set(currency, exchangeRate);
    } catch (err) {
      if (err instanceof ExchangeRateNotFoundError) {
        unconvertedCurrencies.push(currency);
      } else {
        throw err;
      }
    }
  }

  // 4. Produce totals.
  const cash = buildBucket(savingsAccounts, cashByCurrency, rateByCurrency);
  const creditCards = buildBucket(creditCardAccounts, creditCardsByCurrency, rateByCurrency);
  const loans = buildBucket(loanAccounts, loansByCurrency, rateByCurrency);
  const overallNetCash = round2(cash.total + creditCards.total);

  return { overallNetCash, cash, loans, creditCards, unconvertedCurrencies };
}

function buildBucket(accounts: Account[], byCurrency: CurrencyBalance[], rateByCurrency: Map<string, number | null>): NetCashBucket {
  let total = 0;
  for (const bal of byCurrency) {
    const rate = rateByCurrency.get(bal.currency);
    if (rate === undefined) continue; // unconverted currency — excluded from the total, not silently guessed
    total += rate === null ? bal.nativeAmount : bal.nativeAmount / rate;
  }
  return { total: round2(total), byCurrency, accountCount: accounts.length };
}

function groupByCurrency(accounts: Account[]): CurrencyBalance[] {
  const map = new Map<string, number>();
  for (const a of accounts) {
    map.set(a.currency, (map.get(a.currency) ?? 0) + Number(a.current_balance));
  }
  return Array.from(map.entries())
    .map(([currency, nativeAmount]) => ({ currency, nativeAmount: round2(nativeAmount) }))
    .sort((a, b) => (a.currency === "SGD" ? -1 : b.currency === "SGD" ? 1 : 0));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
