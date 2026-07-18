/**
 * Net cash position (TAD-004 §3 Finance Services) — powers Dashboard's Today's Pulse.
 * "Cash" = Savings + CreditCard accounts (credit balances are already negative in the
 * data, so they net out correctly). Investment and LoanToOthers are excluded — per
 * TAD-007 §4 Tier 2, LoanToOthers are receivable trackers, not held cash, and shown
 * separately; Investment value belongs to the Investment screen, not cash position.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account } from "@/domain/account";
import { convertToBaseCurrency, ExchangeRateNotFoundError } from "./exchange.service";

export type CurrencyBalance = {
  currency: string;
  nativeAmount: number;
};

export type NetCashPosition = {
  sgdTotal: number;
  byCurrency: CurrencyBalance[];
  loansOut: CurrencyBalance[];
  /** Currencies that couldn't be converted (no exchange_rates row yet) — excluded from sgdTotal, not silently dropped. */
  unconvertedCurrencies: string[];
};

export async function getNetCashPosition(supabase: SupabaseClient, accounts: Account[]): Promise<NetCashPosition> {
  const active = accounts.filter((a) => a.status === "Active");

  const cashLike = active.filter((a) => a.account_type === "Savings" || a.account_type === "CreditCard");
  const byCurrency = groupByCurrency(cashLike);

  const loanAccounts = active.filter((a) => a.account_type === "LoanToOthers");
  const loansOut = groupByCurrency(loanAccounts);

  let sgdTotal = 0;
  const unconvertedCurrencies: string[] = [];

  // A missing exchange rate is a hard stop for a SAVE (you can't persist an unknown
  // SGD amount on a real financial record) but that's the wrong behavior for a
  // read-only rollup — one missing rate shouldn't 500 the whole Dashboard. Here we
  // skip that currency's contribution and surface it explicitly instead.
  for (const bal of byCurrency) {
    try {
      const { baseAmount } = await convertToBaseCurrency(supabase, bal.nativeAmount, bal.currency);
      sgdTotal += baseAmount;
    } catch (err) {
      if (err instanceof ExchangeRateNotFoundError) {
        unconvertedCurrencies.push(bal.currency);
      } else {
        throw err;
      }
    }
  }

  return { sgdTotal: round2(sgdTotal), byCurrency, loansOut, unconvertedCurrencies };
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
