import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransactionHeader } from "@/domain/transaction-header";

export async function getById(supabase: SupabaseClient, id: string): Promise<TransactionHeader | null> {
  const { data, error } = await supabase
    .from("transaction_headers")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function list(supabase: SupabaseClient): Promise<TransactionHeader[]> {
  const { data, error } = await supabase.from("transaction_headers").select("*");

  if (error) {
    throw error;
  }

  return data || [];
}

/** Most recent `limit` headers by CAPTURE time (transaction_headers.created_at), for the
 *  Dashboard's "Recent Transactions" card — never by the receipt's own printed date. See
 *  CLAUDE.md §7. */
export async function listRecent(supabase: SupabaseClient, limit: number): Promise<TransactionHeader[]> {
  const { data, error } = await supabase
    .from("transaction_headers")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return data || [];
}

/** Headers with transaction_date in [start, end] inclusive, e.g. for a month's spend. */
export async function listByDateRange(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string
): Promise<TransactionHeader[]> {
  const { data, error } = await supabase
    .from("transaction_headers")
    .select("*")
    .gte("transaction_date", startDate)
    .lte("transaction_date", endDate);

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Headers that affect one account's balance — either as source_account_id (Expense,
 * Transfer/Withdrawal out, Adjustment) or as target_account_id (Income, Transfer/Deposit
 * in) — the same two columns the Account Posting Engine posts against (see
 * account-posting.service.ts), so a transaction is visible from an account's history
 * exactly when it moved that account's balance. Bug Fix (Account Transaction History):
 * this previously filtered source_account_id only, so an internal Transfer (e.g. "POSB
 * Bank -> MariBank") never appeared in the destination account's own history even though
 * its balance was posted. Optionally bounded by transaction_date and/or capped to the
 * newest N — for the Account Detail page's period summary (no limit) and Recent
 * Transactions preview (limit: 5), so the preview never pulls more rows than it displays.
 */
export async function listByAccountId(
  supabase: SupabaseClient,
  accountId: string,
  options: { startDate?: string; endDate?: string; limit?: number } = {}
): Promise<TransactionHeader[]> {
  let query = supabase
    .from("transaction_headers")
    .select("*")
    .or(`source_account_id.eq.${accountId},target_account_id.eq.${accountId}`)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (options.startDate) query = query.gte("transaction_date", options.startDate);
  if (options.endDate) query = query.lte("transaction_date", options.endDate);
  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return data || [];
}

/** Whether ANY transaction references this account, as source or target (e.g. a transfer
 *  into it) — used to block permanent account deletion (Delete Protection); Archive is
 *  always safe as the alternative regardless of this result. */
export async function existsForAccountId(supabase: SupabaseClient, accountId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("transaction_headers")
    .select("id", { count: "exact", head: true })
    .or(`source_account_id.eq.${accountId},target_account_id.eq.${accountId}`);

  if (error) {
    throw error;
  }

  return (count ?? 0) > 0;
}

/** Whether ANY transaction is assigned to this project — used to block permanent project
 *  deletion (Project Management Service's delete guard); Mark Inactive is always safe as
 *  the alternative regardless of this result. */
export async function existsForProjectId(supabase: SupabaseClient, projectId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("transaction_headers")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  if (error) {
    throw error;
  }

  return (count ?? 0) > 0;
}

/** All headers assigned to one project (for the Project module's analytics + drill-down). */
export async function listByProjectId(supabase: SupabaseClient, projectId: string): Promise<TransactionHeader[]> {
  const { data, error } = await supabase
    .from("transaction_headers")
    .select("*")
    .eq("project_id", projectId)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Existing headers with the same merchant + date, for duplicate detection
 * (TAD-003 §6 Rule 3). Amount comparison happens in duplicate.verifier.ts, not here —
 * this stays a plain lookup so the repository never contains business rules.
 */
export async function findByMerchantAndDate(
  supabase: SupabaseClient,
  merchant: string,
  transactionDate: string
): Promise<TransactionHeader[]> {
  const { data, error } = await supabase
    .from("transaction_headers")
    .select("*")
    .ilike("merchant", merchant)
    .eq("transaction_date", transactionDate);

  if (error) {
    throw error;
  }

  return data || [];
}

export async function insert(supabase: SupabaseClient, header: Omit<TransactionHeader, "id" | "created_at" | "updated_at">): Promise<TransactionHeader> {
  const { data, error } = await supabase
    .from("transaction_headers")
    .insert(header)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function update(supabase: SupabaseClient, id: string, header: Partial<Omit<TransactionHeader, "id" | "created_at" | "updated_at">>): Promise<TransactionHeader> {
  const { data, error } = await supabase
    .from("transaction_headers")
    .update(header)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function remove(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("transaction_headers").delete().eq("id", id);

  if (error) {
    throw error;
  }
}
