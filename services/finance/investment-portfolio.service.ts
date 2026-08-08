/**
 * Investment Portfolio Version 1 (locked design — see CLAUDE.md §10) — the single place
 * every future Investment screen derives its four metrics from. No persisted
 * investment-specific table, no snapshot mechanism, no second accounting engine: every
 * number here is computed on read from transaction_headers (via the same
 * transactionHeaderRepository.listByAccountId Account Detail already uses) plus
 * accounts.current_balance (already the Adjust/Correct Balance-maintained market value,
 * already posted through the Account Posting Engine — see balance-correction.service.ts).
 *
 * The four metrics, deliberately named to avoid implying lot-level (FIFO/average-cost)
 * accounting this account-level design doesn't do:
 *   - Capital Invested        = TRANSFER in (target = this account) − TRANSFER out (source = this account)
 *   - Current Market Value    = accounts.current_balance, converted to SGD
 *   - Portfolio Gain/Loss     = Current Market Value − Capital Invested
 *   - Dividends / Interest    = INCOME in (target = this account)
 *
 * ADJUSTMENT transactions never contribute to Capital Invested or Dividends/Interest —
 * not via a special-case exclusion, but simply because only TRANSFER and INCOME rows are
 * ever summed. A balance correction (ADJUSTMENT) only ever affects Current Market Value,
 * through current_balance, exactly as every other account type already works.
 *
 * Currency: transaction_headers.sgd_total_amount is already SGD, but accounts.current_balance
 * is stored in the account's own currency (several real Investment accounts are INR/USD) —
 * so Current Market Value is converted via the same exchange.service.ts every other
 * SGD-rollup in the app already uses. A missing exchange rate degrades gracefully (same
 * philosophy as net-cash.service.ts: "shouldn't 500 the whole view over one missing rate")
 * — that account's Current Market Value/Portfolio Gain-Loss come back null and its
 * currency is reported in unconvertedCurrencies, rather than the metric silently guessing.
 *
 * Capital Invested null vs. zero (Investment Portfolio Null Handling review): a true
 * calculated zero (TRANSFER in exactly offset TRANSFER out) is a real, valid value — but
 * an account with NO TRANSFER history at all has nothing to derive Capital Invested from,
 * so it must be null, never silently 0. Presenting an unknown Capital Invested as 0 would
 * make Portfolio Gain/Loss report the account's entire market value as pure gain, which is
 * false, not just imprecise. Every real Investment account in this app today has zero
 * TRANSFER history (balances were seeded directly, not captured as transfers) — this is
 * the common case, not an edge case. Portfolio Gain/Loss inherits null whenever Capital
 * Invested is null, for the same reason it already inherits null when the exchange rate is
 * missing: never substitute zero, never estimate. Dividends/Interest is NOT part of this —
 * a real 0 there doesn't imply anything false, so it's always a plain number.
 *
 * The service never converts null to a placeholder value or string — that's a UI decision,
 * out of scope here (§ "UI Responsibility" review).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as transactionHeaderRepository from "@/repositories/transaction-header.repository";
import type { Account } from "@/domain/account";
import { TRANSACTION_TYPES } from "@/constants/transaction-types";
import { convertToBaseCurrency, ExchangeRateNotFoundError } from "./exchange.service";

export type InvestmentPortfolioMetrics = {
  /** null when this account has zero TRANSFER transactions (in or out) — nothing to
   *  derive Capital Invested from. A real calculated 0 (in exactly offsets out) is
   *  distinct and valid. */
  capitalInvestedSgd: number | null;
  /** null when this account's currency has no exchange rate on file yet. */
  currentMarketValueSgd: number | null;
  /** null when EITHER capitalInvestedSgd or currentMarketValueSgd is null — never
   *  substituted with zero or estimated from a partial input. */
  portfolioGainLossSgd: number | null;
  dividendsSgd: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Accumulates `addend` into `current`, skipping (never zeroing) a null addend — an
 *  account excluded from a total must not silently count as a real 0 contribution. The
 *  running total itself only becomes a real number once at least one real addend has been
 *  seen; if every account excluded, the total stays null too (same null-vs-zero
 *  distinction as the per-account metrics, just at the aggregate level). */
function sumOrNull(current: number | null, addend: number | null): number | null {
  if (addend === null) return current;
  return round2((current ?? 0) + addend);
}

/** The four Version 1 metrics for one Investment account. `account` is passed in rather
 *  than re-fetched — callers (an account list, an account detail page) already have it
 *  loaded, and current_balance is the metric's own Current Market Value input. */
export async function getInvestmentPortfolioForAccount(supabase: SupabaseClient, account: Account): Promise<InvestmentPortfolioMetrics> {
  const headers = await transactionHeaderRepository.listByAccountId(supabase, account.id);

  let capitalIn = 0;
  let capitalOut = 0;
  let transferCount = 0;
  let dividends = 0;

  for (const h of headers) {
    const amount = Number(h.sgd_total_amount);
    if (h.transaction_type === TRANSACTION_TYPES.TRANSFER) {
      transferCount++;
      if (h.target_account_id === account.id) capitalIn += amount;
      if (h.source_account_id === account.id) capitalOut += amount;
    } else if (h.transaction_type === TRANSACTION_TYPES.INCOME && h.target_account_id === account.id) {
      dividends += amount;
    }
  }

  const capitalInvestedSgd = transferCount === 0 ? null : round2(capitalIn - capitalOut);

  let currentMarketValueSgd: number | null = null;
  try {
    const { baseAmount } = await convertToBaseCurrency(supabase, Number(account.current_balance), account.currency);
    currentMarketValueSgd = round2(baseAmount);
  } catch (err) {
    if (!(err instanceof ExchangeRateNotFoundError)) throw err;
  }

  return {
    capitalInvestedSgd,
    currentMarketValueSgd,
    portfolioGainLossSgd: capitalInvestedSgd === null || currentMarketValueSgd === null ? null : round2(currentMarketValueSgd - capitalInvestedSgd),
    dividendsSgd: round2(dividends),
  };
}

export type InvestmentPortfolioAccountMetrics = InvestmentPortfolioMetrics & { account: Account };

export type InvestmentPortfolioSummary = {
  accounts: InvestmentPortfolioAccountMetrics[];
  total: InvestmentPortfolioMetrics;
  /** Currencies excluded from total.currentMarketValueSgd/portfolioGainLossSgd because
   *  no exchange rate is on file — same reporting convention as net-cash.service.ts's
   *  own unconvertedCurrencies, so a Portfolio screen can surface the same warning UI. */
  unconvertedCurrencies: string[];
  /** Account ids excluded from total.capitalInvestedSgd/portfolioGainLossSgd because they
   *  have no TRANSFER history to derive Capital Invested from — same shape/convention as
   *  unconvertedCurrencies above, just keyed by account instead of currency. One account
   *  can appear here, in unconvertedCurrencies' cause, or both; the total simply excludes
   *  whatever it can't honestly compute rather than letting one unknown null everything. */
  accountsWithoutCapitalHistory: string[];
};

/** The whole portfolio — every Active Investment account's own metrics, plus a total
 *  that's a plain sum of the same per-account calculation above (never a second,
 *  independently-derived aggregate query). `accounts` is the full account list a caller
 *  already loaded (e.g. Dashboard/Accounts' own accountRepository.list() call) — this
 *  filters to Investment/Active itself rather than requiring a second repository call. */
export async function getInvestmentPortfolioSummary(supabase: SupabaseClient, accounts: Account[]): Promise<InvestmentPortfolioSummary> {
  const investmentAccounts = accounts.filter((a) => a.account_type === "Investment" && a.status === "Active");

  const accountMetrics = await Promise.all(
    investmentAccounts.map(async (account) => ({
      account,
      ...(await getInvestmentPortfolioForAccount(supabase, account)),
    }))
  );

  const unconvertedCurrencies = Array.from(
    new Set(accountMetrics.filter((m) => m.currentMarketValueSgd === null).map((m) => m.account.currency))
  );
  const accountsWithoutCapitalHistory = accountMetrics.filter((m) => m.capitalInvestedSgd === null).map((m) => m.account.id);

  const total = accountMetrics.reduce<InvestmentPortfolioMetrics>(
    (sum, m) => ({
      capitalInvestedSgd: sumOrNull(sum.capitalInvestedSgd, m.capitalInvestedSgd),
      currentMarketValueSgd: sumOrNull(sum.currentMarketValueSgd, m.currentMarketValueSgd),
      portfolioGainLossSgd: sumOrNull(sum.portfolioGainLossSgd, m.portfolioGainLossSgd),
      dividendsSgd: round2(sum.dividendsSgd + m.dividendsSgd),
    }),
    { capitalInvestedSgd: null, currentMarketValueSgd: null, portfolioGainLossSgd: null, dividendsSgd: 0 }
  );

  return { accounts: accountMetrics, total, unconvertedCurrencies, accountsWithoutCapitalHistory };
}
