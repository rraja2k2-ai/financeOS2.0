/**
 * Grouped account view (TAD-004 §3 Finance Services) — powers the Accounts screen.
 * Groups active accounts SGD -> INR -> Other currencies (per the approved design),
 * and within each currency group orders by type: Banks & Cash -> Credit ->
 * Investments -> Receivable. LoanToOthers accounts are receivable trackers, not held
 * cash (TAD-007 §4 Tier 2) — grouped separately, included in net worth as an asset.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account } from "@/domain/account";
import { convertToBaseCurrency, ExchangeRateNotFoundError } from "./exchange.service";

const TYPE_LABELS: Record<string, string> = {
  Savings: "Banks & Cash",
  CreditCard: "Credit",
  Investment: "Investments",
  LoanToOthers: "Receivable",
};

// Display/sort order within a currency group.
const TYPE_ORDER = ["Savings", "CreditCard", "Investment", "LoanToOthers"];

export type AccountRow = {
  id: string;
  accountName: string;
  accountType: string;
  currency: string;
  nativeBalance: number;
  /** null if this currency has no exchange_rates row yet (see unconvertedCurrencies). */
  sgdBalance: number | null;
};

export type AccountTypeGroup = {
  /** e.g. "Banks & Cash", or "USD · Investments" inside the Other-currencies group. */
  label: string;
  accounts: AccountRow[];
};

export type CurrencyGroup = {
  key: string; // "SGD" | "INR" | "OTHER"
  label: string;
  /** Sum of this group's accounts in SGD, or null if nothing in it converted. */
  totalSgd: number | null;
  typeGroups: AccountTypeGroup[];
};

export type GroupedAccounts = {
  netWorthSgd: number;
  unconvertedCurrencies: string[];
  groups: CurrencyGroup[];
};

export async function getGroupedAccounts(supabase: SupabaseClient, accounts: Account[]): Promise<GroupedAccounts> {
  const active = accounts.filter((a) => a.status === "Active");

  const rows: AccountRow[] = [];
  const unconvertedCurrencies = new Set<string>();
  let netWorthSgd = 0;

  for (const a of active) {
    const nativeBalance = Number(a.current_balance);
    let sgdBalance: number | null = null;
    try {
      const { baseAmount } = await convertToBaseCurrency(supabase, nativeBalance, a.currency);
      sgdBalance = round2(baseAmount);
      netWorthSgd += baseAmount;
    } catch (err) {
      if (err instanceof ExchangeRateNotFoundError) {
        unconvertedCurrencies.add(a.currency);
      } else {
        throw err;
      }
    }
    rows.push({
      id: a.id,
      accountName: a.account_name,
      accountType: a.account_type,
      currency: a.currency,
      nativeBalance: round2(nativeBalance),
      sgdBalance,
    });
  }

  const sgdRows = rows.filter((r) => r.currency === "SGD");
  const inrRows = rows.filter((r) => r.currency === "INR");
  const otherRows = rows.filter((r) => r.currency !== "SGD" && r.currency !== "INR");

  const groups: CurrencyGroup[] = [
    { key: "SGD", label: "SGD", totalSgd: sumSgd(sgdRows), typeGroups: buildTypeGroups(sgdRows, false) },
    { key: "INR", label: "INR", totalSgd: sumSgd(inrRows), typeGroups: buildTypeGroups(inrRows, false) },
    {
      key: "OTHER",
      label: "Other currencies",
      totalSgd: sumSgd(otherRows),
      typeGroups: buildTypeGroups(otherRows, true),
    },
  ].filter((g) => g.typeGroups.length > 0);

  return { netWorthSgd: round2(netWorthSgd), unconvertedCurrencies: Array.from(unconvertedCurrencies), groups };
}

function buildTypeGroups(rows: AccountRow[], prefixCurrency: boolean): AccountTypeGroup[] {
  const byType = new Map<string, AccountRow[]>();
  for (const r of rows) {
    if (!byType.has(r.accountType)) byType.set(r.accountType, []);
    byType.get(r.accountType)!.push(r);
  }

  if (!prefixCurrency) {
    return TYPE_ORDER.filter((t) => byType.has(t)).map((t) => ({
      label: TYPE_LABELS[t] ?? t,
      accounts: byType.get(t)!,
    }));
  }

  // "Other currencies" — sub-split by currency, then by type within each currency.
  const currencies = Array.from(new Set(rows.map((r) => r.currency))).sort();
  const result: AccountTypeGroup[] = [];
  for (const currency of currencies) {
    const currencyRows = rows.filter((r) => r.currency === currency);
    const byTypeForCurrency = new Map<string, AccountRow[]>();
    for (const r of currencyRows) {
      if (!byTypeForCurrency.has(r.accountType)) byTypeForCurrency.set(r.accountType, []);
      byTypeForCurrency.get(r.accountType)!.push(r);
    }
    for (const t of TYPE_ORDER) {
      if (!byTypeForCurrency.has(t)) continue;
      result.push({ label: `${currency} · ${TYPE_LABELS[t] ?? t}`, accounts: byTypeForCurrency.get(t)! });
    }
  }
  return result;
}

function sumSgd(rows: AccountRow[]): number | null {
  const known = rows.filter((r) => r.sgdBalance !== null);
  if (known.length === 0) return null;
  return round2(known.reduce((sum, r) => sum + (r.sgdBalance ?? 0), 0));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
