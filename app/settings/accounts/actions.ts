"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase";
import { accountRepository } from "@/repositories";
import {
  createAccount,
  updateAccount,
  archiveAccount,
  restoreAccount,
  deleteAccount,
  type AccountInput,
  type AccountUpdateInput,
} from "@/services/finance/account-management.service";
import { correctAccountBalance } from "@/services/finance/balance-correction.service";
import type { Account } from "@/domain/account";

function revalidateAccountPaths(id?: string) {
  revalidatePath("/settings/accounts");
  revalidatePath("/accounts");
  if (id) revalidatePath(`/accounts/${id}`);
  // Dashboard's Net Cash card reads account balances too — every account mutation
  // (edit/archive/restore/delete/adjust) needs to invalidate it, not just reorder.
  revalidatePath("/");
}

export async function createAccountAction(input: AccountInput) {
  const supabase = await createServerSupabaseClient();
  const account = await createAccount(supabase, input);
  revalidateAccountPaths();
  return account;
}

export async function updateAccountAction(id: string, input: AccountUpdateInput) {
  const supabase = await createServerSupabaseClient();
  const account = await updateAccount(supabase, id, input);
  revalidateAccountPaths(id);
  return account;
}

export async function archiveAccountAction(id: string) {
  const supabase = await createServerSupabaseClient();
  const account = await archiveAccount(supabase, id);
  revalidateAccountPaths(id);
  return account;
}

export async function restoreAccountAction(id: string) {
  const supabase = await createServerSupabaseClient();
  const account = await restoreAccount(supabase, id);
  revalidateAccountPaths(id);
  return account;
}

export async function deleteAccountAction(id: string) {
  const supabase = await createServerSupabaseClient();
  await deleteAccount(supabase, id);
  revalidateAccountPaths(id);
}

/** Decision 1/2 — the one sanctioned way to change Current Balance: builds and posts a
 *  system-generated ADJUSTMENT transaction through the normal save + Posting Engine path
 *  (see balance-correction.service.ts). Never writes current_balance directly. `reason`
 *  is mandatory (v1.8.0 Account Balance Adjustment). */
export async function correctAccountBalanceAction(accountId: string, newBalance: number, reason: string): Promise<Account> {
  const supabase = await createServerSupabaseClient();
  await correctAccountBalance(supabase, accountId, newBalance, reason);
  const account = await accountRepository.getById(supabase, accountId);
  revalidateAccountPaths(accountId);
  revalidatePath("/activity");
  if (!account) {
    throw new Error("Balance corrected, but the account could not be reloaded. Refresh to see the new balance.");
  }
  return account;
}

/** Decision 7 — persists a full reordering. `orderedIds` is the complete new top-to-bottom
 *  order for the accounts currently visible in the reorder UI (per currency/type group). */
export async function reorderAccountsAction(orderedIds: string[]) {
  const supabase = await createServerSupabaseClient();
  await accountRepository.reorder(supabase, orderedIds);
  revalidatePath("/settings/accounts");
  revalidatePath("/accounts");
  revalidatePath("/");
  revalidatePath("/activity");
}
