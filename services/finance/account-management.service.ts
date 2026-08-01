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

/** Decision 3 (Master Data & Account Management Refactor) — Opening Balance is editable
 *  only at creation; every field an Edit Account submission can actually change. */
export type AccountUpdateInput = Omit<AccountInput, "openingBalance">;

/** Shared by create and update — same rules apply to both (§5: blank names, invalid
 *  balances, duplicate names are all checked before either ever reaches the repository). */
function validateCommonInput(input: Pick<AccountInput, "accountName" | "accountType" | "currency">): { name: string } {
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
  return { name };
}

/** Opening Balance is only ever parsed/validated at creation (Decision 3) — updateAccount
 *  no longer accepts it at all, so there is no "which value wins" ambiguity to guard against. */
function parseOpeningBalance(openingBalance: string): number {
  // String() guards against a caller passing the Account row's own opening_balance back
  // in (e.g. a form seeded from an existing account) — Postgres/PostgREST returns that
  // column as a JSON number despite the Account domain type declaring it `string`.
  const openingBalanceStr = String(openingBalance ?? "").trim();
  const balance = Number(openingBalanceStr);
  if (openingBalanceStr === "" || !Number.isFinite(balance)) {
    throw new Error("Opening balance must be a number.");
  }
  return balance;
}

/** New accounts start with no transactions, so Current Balance == Opening Balance at
 *  creation time — nothing in the app recalculates current_balance from transactions
 *  (it's an independently maintained field), so this is the only place it's ever set. */
export async function createAccount(supabase: SupabaseClient, input: AccountInput): Promise<Account> {
  const { name } = validateCommonInput(input);
  const balance = parseOpeningBalance(input.openingBalance);

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
    // New accounts append to the end of the display order (Decision 7) — null falls
    // last per account.repository.ts's list() ordering until the user reorders it.
    display_order: null,
  });
}

/** Current Balance, Opening Balance, and status are intentionally absent — not editable
 *  fields here (Decision 3: Opening Balance is creation-only, historical afterwards;
 *  Archive/Restore below own status; current_balance is never user-editable anywhere —
 *  see balance-correction.service.ts for the one sanctioned way to change it). */
export async function updateAccount(supabase: SupabaseClient, id: string, input: AccountUpdateInput): Promise<Account> {
  const { name } = validateCommonInput(input);

  if (await accountRepository.existsByName(supabase, name, id)) {
    throw new Error(`An account named "${name}" already exists.`);
  }

  return accountRepository.update(supabase, id, {
    account_name: name,
    account_type: input.accountType,
    currency: input.currency,
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
