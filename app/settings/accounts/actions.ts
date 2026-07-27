"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  createAccount,
  updateAccount,
  archiveAccount,
  restoreAccount,
  deleteAccount,
  type AccountInput,
} from "@/services/finance/account-management.service";

function revalidateAccountPaths(id?: string) {
  revalidatePath("/settings/accounts");
  revalidatePath("/accounts");
  if (id) revalidatePath(`/accounts/${id}`);
}

export async function createAccountAction(input: AccountInput) {
  const supabase = await createServerSupabaseClient();
  const account = await createAccount(supabase, input);
  revalidateAccountPaths();
  return account;
}

export async function updateAccountAction(id: string, input: AccountInput) {
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
