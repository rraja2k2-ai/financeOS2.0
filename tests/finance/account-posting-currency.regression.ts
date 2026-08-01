/**
 * Regression test for the Adjust Balance accuracy bug (v1.8.0 PR #20 review): the
 * Account Posting Engine used to re-derive EVERY leg's native delta from
 * sgd_total_amount via a base-currency round trip, even for the leg whose account
 * currency already matched the transaction's own currency — losing precision on any
 * non-base-currency account (e.g. adjusting an INR account to an exact target landed a
 * few cents off).
 *
 * No network/Supabase project required — a minimal fake SupabaseClient stands in for
 * the one table (`exchange_rates`) computePostingDeltas can reach through
 * exchange.service.ts's convertFromBaseCurrency, so this runs standalone in CI.
 *
 * Usage: npm run test:account-posting
 */
import assert from "node:assert/strict";
import { computePostingDeltas, type PostingHeader } from "@/services/finance/account-posting.service";

type ExchangeRateRow = { base_currency: string; target_currency: string; rate: string; rate_date: string };

/**
 * Fakes just enough of SupabaseClient's fluent query builder to satisfy
 * exchange-rate.repository.ts's getBaseCurrency()/getLatestRate() — the only
 * repository calls reachable from computePostingDeltas. Tracks how many times the
 * `exchange_rates` table was actually queried, so a same-currency test can assert the
 * lossy round trip was skipped entirely, not just rounded differently.
 */
function createFakeSupabase(rates: ExchangeRateRow[], baseCurrency: string) {
  let exchangeRateQueries = 0;

  function builder(table: string) {
    if (table !== "exchange_rates") {
      throw new Error(`Fake Supabase: unexpected table "${table}"`);
    }
    const filters: Record<string, string> = {};
    let selectedBaseCurrencyOnly = false;

    const chain = {
      select(columns: string) {
        selectedBaseCurrencyOnly = columns === "base_currency";
        return chain;
      },
      eq(column: string, value: string) {
        filters[column] = value;
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      async maybeSingle() {
        exchangeRateQueries++;
        if (selectedBaseCurrencyOnly) {
          return { data: { base_currency: baseCurrency }, error: null };
        }
        const match = rates.find((r) => r.base_currency === filters.base_currency && r.target_currency === filters.target_currency);
        return { data: match ?? null, error: null };
      },
    };
    return chain;
  }

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: { from: builder } as any,
    get exchangeRateQueryCount() {
      return exchangeRateQueries;
    },
  };
}

async function testSameCurrencyUsesOriginalAmount() {
  const fake = createFakeSupabase([{ base_currency: "SGD", target_currency: "INR", rate: "63.50", rate_date: "2026-08-01" }], "SGD");
  const accountId = "acct-inr";
  const header: PostingHeader = {
    transaction_type: "ADJUSTMENT",
    source_account_id: accountId,
    target_account_id: null,
    currency: "INR",
    original_amount: -0.32, // the EXACT native delta — must be used as-is
    sgd_total_amount: -0.01, // an approximate SGD equivalent; irrelevant to the result
  };
  const currencyById = new Map([[accountId, "INR"]]);

  const deltas = await computePostingDeltas(fake.client, header, currencyById);

  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].accountId, accountId);
  assert.equal(deltas[0].delta, -0.32, "same-currency leg must use original_amount exactly, not a base-currency round trip");
  assert.equal(fake.exchangeRateQueryCount, 0, "same-currency leg must never query exchange_rates at all");
}

async function testCrossCurrencyUsesExchangeRateConversion() {
  const fake = createFakeSupabase([{ base_currency: "SGD", target_currency: "INR", rate: "63.50", rate_date: "2026-08-01" }], "SGD");
  const sourceId = "acct-sgd";
  const targetId = "acct-inr";
  const header: PostingHeader = {
    transaction_type: "TRANSFER",
    source_account_id: sourceId,
    target_account_id: targetId,
    currency: "SGD",
    original_amount: 100,
    sgd_total_amount: 100,
  };
  const currencyById = new Map([
    [sourceId, "SGD"],
    [targetId, "INR"],
  ]);

  const deltas = await computePostingDeltas(fake.client, header, currencyById);
  const bySource = deltas.find((d) => d.accountId === sourceId);
  const byTarget = deltas.find((d) => d.accountId === targetId);

  assert.ok(bySource && byTarget, "expected one delta per leg");
  assert.equal(bySource!.delta, -100, "same-currency source leg still uses original_amount exactly");
  assert.equal(byTarget!.delta, 6350, "cross-currency target leg must convert via the exchange rate (100 * 63.50)");
  assert.ok(fake.exchangeRateQueryCount > 0, "the genuinely cross-currency leg must query exchange_rates");
}

async function testAdjustingNonSgdAccountToZeroLandsExactlyOnZero() {
  const { client } = createFakeSupabase([{ base_currency: "SGD", target_currency: "INR", rate: "63.50", rate_date: "2026-08-01" }], "SGD");
  const accountId = "acct-inr";
  const previousBalance = 0.32;
  const targetBalance = 0.0;
  const difference = Math.round((targetBalance - previousBalance) * 100) / 100; // -0.32, same math as balance-correction.service.ts

  const header: PostingHeader = {
    transaction_type: "ADJUSTMENT",
    source_account_id: accountId,
    target_account_id: null,
    currency: "INR",
    original_amount: difference,
    sgd_total_amount: Math.round((difference / 63.5) * 100) / 100,
  };
  const currencyById = new Map([[accountId, "INR"]]);

  const deltas = await computePostingDeltas(client, header, currencyById);
  const resultingBalance = Math.round((previousBalance + deltas[0].delta) * 100) / 100;

  assert.equal(resultingBalance, 0, `adjusting a non-SGD account to 0.00 must land exactly on 0, got ${resultingBalance}`);
}

async function main() {
  const tests: [string, () => Promise<void>][] = [
    ["same-currency posting uses original_amount", testSameCurrencyUsesOriginalAmount],
    ["cross-currency posting uses exchange-rate conversion", testCrossCurrencyUsesExchangeRateConversion],
    ["adjusting a non-SGD account to zero lands exactly on zero", testAdjustingNonSgdAccountToZeroLandsExactlyOnZero],
  ];

  let failed = 0;
  for (const [name, run] of tests) {
    try {
      await run();
      console.log(`PASS - ${name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL - ${name}`);
      console.error(err instanceof Error ? err.message : err);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed}/${tests.length} test(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${tests.length} test(s) passed.`);
}

main();
