/**
 * Attachment Management MVP — Manual Cleanup (Settings → Data Management). Deliberately
 * small: no archive stage, no storage tiers, no background scheduler — a single
 * on-demand operation the user triggers themselves. Deletes ONLY the original Storage
 * file for attachments older than the chosen retention period and not flagged Keep
 * Attachment; the transaction, its items, and every financial field are untouched, and
 * the attachment row itself remains (see receipt-attachment.repository.ts's
 * clearStoragePaths doc comment).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as receiptAttachmentRepository from "@/repositories/receipt-attachment.repository";
import * as receiptStorageRepository from "@/repositories/receipt-storage.repository";

/** The only three real retention choices — "Never" is `null` (nothing is ever eligible). */
export const RETENTION_OPTIONS = [30, 90, 180] as const;
export type RetentionDays = (typeof RETENTION_OPTIONS)[number];

export type CleanupResult = {
  deletedCount: number;
};

export async function runAttachmentCleanup(supabase: SupabaseClient, retentionDays: RetentionDays | null): Promise<CleanupResult> {
  if (retentionDays === null) {
    return { deletedCount: 0 };
  }

  const cutoffIso = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const eligible = await receiptAttachmentRepository.listEligibleForCleanup(supabase, cutoffIso);

  if (eligible.length === 0) {
    return { deletedCount: 0 };
  }

  const paths = eligible.map((a) => a.storage_path).filter((p): p is string => !!p);
  await receiptStorageRepository.removeReceiptPages(supabase, paths);
  await receiptAttachmentRepository.clearStoragePaths(
    supabase,
    eligible.map((a) => a.id)
  );

  return { deletedCount: eligible.length };
}
