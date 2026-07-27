/**
 * Account CRUD workflow (Settings -> Accounts Management). Validation + duplicate-name
 * + delete-protection checks live here, never in the UI or the repository layer.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as accountRepository from "@/repositories/account.repository";
import * as transactionHeaderRepository from "@/repositories/transaction-header.repository";
import type { Account } from "@/domain/account";
import { ACCOUNT_TYPES, type AccountType } from "@/constants/accounts";
import { ALL_CURRENCIES } from "@/domain/exchange-rate";

/** Thrown by deleteAccount when the account has transaction history — callers show its
 *  message verbatim rather than a generic failure, so the user knows to Archive instead. */
export class AccountHasTransactionsError extends Error {}

export type AccountInput = {
  accountName: string;
  accountType: string;
  currency: string;
  openingBalance: string;
  notes: string;
};

/** Shared by create and update — same rules apply to both (§5: blank names, invalid
 *  balances, duplicate names are all checked before either ever reaches the repository). */
function validateInput(input: AccountInput): { name: string; balance: number } {
  const name = input.accountName.trim();
  if (!name) {
    throw new Error("Account name is required.");
  }
  if (!ACCOUNT_TYPES.includes(input.accountType as AccountType)) {
    throw new Error("Select a valid account type.");
  }
  if (!ALL_CURRENCIES.includes(input.currency)) {
    throw new Error("Select a supported currency.");
  }
  // String() guards against a caller passing the Account row's own opening_balance back
  // in (e.g. an Edit form seeded from an existing account) — Postgres/PostgREST returns
  // that column as a JSON number despite the Account domain type declaring it `string`.
  const openingBalanceStr = String(input.openingBalance ?? "").trim();
  const balance = Number(openingBalanceStr);
  if (openingBalanceStr === "" || !Number.isFinite(balance)) {
    throw new Error("Opening balance must be a number.");
  }
  return { name, balance };
}

/** New accounts start with no transactions, so Current Balance == Opening Balance at
 *  creation time — nothing in the app recalculates current_balance from transactions
 *  (it's an independently maintained field), so this is the only place it's ever set. */
export async function createAccount(supabase: SupabaseClient, input: AccountInput): Promise<Account> {
  const { name, balance } = validateInput(input);

  if (await accountRepository.existsByName(supabase, name)) {
    throw new Error(`An account named "${name}" already exists.`);
  }

  return accountRepository.insert(supabase, {
    account_name: name,
    account_type: input.accountType,
    currency: input.currency,
    opening_balance: String(balance),
    current_balance: String(balance),
    status: "Active",
    notes: input.notes.trim() || null,
  });
}

/** Current Balance and status are intentionally absent — not editable fields per spec;
 *  Archive/Restore below own status, and current_balance is never user-editable here. */
export async function updateAccount(supabase: SupabaseClient, id: string, input: AccountInput): Promise<Account> {
  const { name, balance } = validateInput(input);

  if (await accountRepository.existsByName(supabase, name, id)) {
    throw new Error(`An account named "${name}" already exists.`);
  }

  return accountRepository.update(supabase, id, {
    account_name: name,
    account_type: input.accountType,
    currency: input.currency,
    opening_balance: String(balance),
    notes: input.notes.trim() || null,
  });
}

/** Archived accounts already fall out of every "Active"-filtered read path in the app
 *  (Dashboard's net-cash.service.ts, Capture's master-data.service.ts, the Accounts
 *  screen's accounts.service.ts) purely because they all filter status === "Active" —
 *  reusing that same status column here needs no changes to any of them. */
export async function archiveAccount(supabase: SupabaseClient, id: string): Promise<Account> {
  return accountRepository.update(supabase, id, { status: "Inactive" });
}

export async function restoreAccount(supabase: SupabaseClient, id: string): Promise<Account> {
  return accountRepository.update(supabase, id, { status: "Active" });
}

/** Blocks permanent deletion if the account has any transaction history (as source or
 *  target); Archive is always the safe alternative regardless of transaction history. */
export async function deleteAccount(supabase: SupabaseClient, id: string): Promise<void> {
  const hasTransactions = await transactionHeaderRepository.existsForAccountId(supabase, id);
  if (hasTransactions) {
    throw new AccountHasTransactionsError("This account contains transactions and cannot be deleted. Archive it instead.");
  }
  await accountRepository.remove(supabase, id);
}
