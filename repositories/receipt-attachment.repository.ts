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
