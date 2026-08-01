"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase";
import { runAttachmentCleanup, type RetentionDays } from "@/services/finance/attachment-cleanup.service";

export async function runAttachmentCleanupAction(retentionDays: RetentionDays | null) {
  const supabase = await createServerSupabaseClient();
  const result = await runAttachmentCleanup(supabase, retentionDays);
  revalidatePath("/settings/data-management");
  return result;
}
