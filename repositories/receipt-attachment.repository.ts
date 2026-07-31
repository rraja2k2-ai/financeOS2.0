import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReceiptAttachment } from "@/domain/receipt-attachment";

export async function getById(supabase: SupabaseClient, id: string): Promise<ReceiptAttachment | null> {
  const { data, error } = await supabase
    .from("receipt_attachments")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function list(supabase: SupabaseClient): Promise<ReceiptAttachment[]> {
  const { data, error } = await supabase.from("receipt_attachments").select("*");

  if (error) {
    throw error;
  }

  return data || [];
}

export async function insert(supabase: SupabaseClient, attachment: Omit<ReceiptAttachment, "id" | "created_at">): Promise<ReceiptAttachment> {
  const { data, error } = await supabase
    .from("receipt_attachments")
    .insert(attachment)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function update(supabase: SupabaseClient, id: string, attachment: Partial<Omit<ReceiptAttachment, "id" | "created_at">>): Promise<ReceiptAttachment> {
  const { data, error } = await supabase
    .from("receipt_attachments")
    .update(attachment)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function remove(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("receipt_attachments").delete().eq("id", id);

  if (error) {
    throw error;
  }
}

/** Removes all attachment rows for one transaction (DB records only — Storage files are untouched). */
export async function removeByHeaderId(supabase: SupabaseClient, headerId: string): Promise<void> {
  const { error } = await supabase.from("receipt_attachments").delete().eq("header_id", headerId);

  if (error) {
    throw error;
  }
}

/** A saved transaction's receipt pages, in page order — powers the Receipt Viewer. */
export async function listByHeaderId(supabase: SupabaseClient, headerId: string): Promise<ReceiptAttachment[]> {
  const { data, error } = await supabase
    .from("receipt_attachments")
    .select("*")
    .eq("header_id", headerId)
    .order("page_no", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Attachments whose original file is eligible for Manual Cleanup: created before
 * `cutoffIso`, not flagged Keep Attachment, and still has a Storage file to remove
 * (already-cleaned rows have `storage_path = null` and are naturally excluded).
 */
export async function listEligibleForCleanup(supabase: SupabaseClient, cutoffIso: string): Promise<ReceiptAttachment[]> {
  const { data, error } = await supabase
    .from("receipt_attachments")
    .select("*")
    .eq("keep_attachment", false)
    .not("storage_path", "is", null)
    .lt("created_at", cutoffIso);

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Clears storage_path (only) on the given attachment rows — called once their Storage
 * files have been removed, so the app knows not to look for them again. The row itself
 * stays, per the Attachment Management MVP's "record may remain to indicate a receipt
 * once existed."
 */
export async function clearStoragePaths(supabase: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const { error } = await supabase.from("receipt_attachments").update({ storage_path: null }).in("id", ids);

  if (error) {
    throw error;
  }
}
