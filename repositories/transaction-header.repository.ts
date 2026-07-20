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

/** The single most recently CAPTURED header (transaction_headers.created_at) — used to
 *  find "the transaction a just-finished background capture became," never by the
 *  receipt's own printed date. Distinct from listRecent, which orders by transaction_date
 *  for the Dashboard's "Recent Activity" card — a different, unrelated concern. */
export async function getLatest(supabase: SupabaseClient): Promise<TransactionHeader | null> {
  const { data, error } = await supabase
    .from("transaction_headers")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/** Most recent `limit` headers by transaction_date, for a "Recent Activity" style view. */
export async function listRecent(supabase: SupabaseClient, limit: number): Promise<TransactionHeader[]> {
  const { data, error } = await supabase
    .from("transaction_headers")
    .select("*")
    .order("transaction_date", { ascending: false })
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
