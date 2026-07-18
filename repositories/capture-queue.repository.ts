import type { SupabaseClient } from "@supabase/supabase-js";
import type { CaptureQueueItem } from "@/domain/capture-queue";

export async function list(supabase: SupabaseClient): Promise<CaptureQueueItem[]> {
  const { data, error } = await supabase.from("capture_queue").select("*").order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

export async function getById(supabase: SupabaseClient, id: string): Promise<CaptureQueueItem | null> {
  const { data, error } = await supabase.from("capture_queue").select("*").eq("id", id).maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function insert(
  supabase: SupabaseClient,
  item: Omit<CaptureQueueItem, "id" | "created_at" | "updated_at">
): Promise<CaptureQueueItem> {
  const { data, error } = await supabase.from("capture_queue").insert(item).select().single();

  if (error) {
    throw error;
  }

  return data;
}

export async function update(
  supabase: SupabaseClient,
  id: string,
  item: Partial<Omit<CaptureQueueItem, "id" | "created_at">>
): Promise<void> {
  const { error } = await supabase
    .from("capture_queue")
    .update({ ...item, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    throw error;
  }
}

export async function remove(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("capture_queue").delete().eq("id", id);

  if (error) {
    throw error;
  }
}
