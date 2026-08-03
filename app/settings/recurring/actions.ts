"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  createRecurringRuleFromTransaction,
  updateRecurringRule,
  deleteRecurringRule,
  setRecurringRuleActive,
  generateDueTransactions,
  type RecurringRuleFields,
} from "@/services/finance/recurring-rule.service";
import type { RecurringInterval, RecurringEndMode } from "@/domain/recurring-rule";

/** "Make Recurring" — merchant/category/account/project/comments are silently inherited
 *  from the transaction; only the recurrence settings are asked for (see the service for
 *  why start_date is computed, never asked). */
export async function createRecurringRuleFromTransactionAction(
  headerId: string,
  recurrence: {
    intervalCount: number;
    intervalUnit: RecurringInterval;
    endMode: RecurringEndMode;
    endDate: string | null;
    occurrenceCount: number | null;
  }
) {
  const supabase = await createServerSupabaseClient();
  await createRecurringRuleFromTransaction(supabase, headerId, recurrence);
  revalidatePath("/settings/recurring");
}

export async function updateRecurringRuleAction(id: string, fields: RecurringRuleFields) {
  const supabase = await createServerSupabaseClient();
  await updateRecurringRule(supabase, id, fields);
  revalidatePath("/settings/recurring");
}

export async function setRecurringRuleActiveAction(id: string, isActive: boolean) {
  const supabase = await createServerSupabaseClient();
  await setRecurringRuleActive(supabase, id, isActive);
  revalidatePath("/settings/recurring");
}

export async function deleteRecurringRuleAction(id: string) {
  const supabase = await createServerSupabaseClient();
  await deleteRecurringRule(supabase, id);
  revalidatePath("/settings/recurring");
}

/** Generated transactions affect account balances and appear in Activity/Dashboard —
 *  revalidated alongside /recurring itself, same pattern as account mutation actions. */
export async function generateRecurringTransactionsAction(until: string) {
  const supabase = await createServerSupabaseClient();
  const results = await generateDueTransactions(supabase, until);
  revalidatePath("/settings/recurring");
  revalidatePath("/activity");
  revalidatePath("/");
  return results;
}
