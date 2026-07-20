/**
 * Supabase Storage access for original receipt files (C4.1). Same boundary role as the
 * table repositories — the only place that talks to the "receipts" bucket. Stores the
 * ORIGINAL file only: no thumbnails, no compression.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const RECEIPTS_BUCKET = "receipts";

export type UploadedReceiptPage = {
  storagePath: string;
  mimeType: string;
  fileSizeBytes: number;
};

/** Uploads one original receipt page's bytes to `path` in the receipts bucket. */
export async function uploadReceiptPage(
  supabase: SupabaseClient,
  path: string,
  bytes: Buffer,
  mimeType: string
): Promise<UploadedReceiptPage> {
  const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, bytes, {
    contentType: mimeType,
    upsert: false,
  });

  if (error) {
    throw error;
  }

  return { storagePath: path, mimeType, fileSizeBytes: bytes.length };
}

/** Best-effort cleanup — removes uploaded pages if a save fails before they're referenced by a saved transaction. */
export async function removeReceiptPages(supabase: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await supabase.storage.from(RECEIPTS_BUCKET).remove(paths);
}

/** A time-limited URL for a private-bucket file — the bucket has no public read access. */
export async function getSignedUrl(supabase: SupabaseClient, path: string, expiresInSeconds = 3600): Promise<string | null> {
  const { data } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, expiresInSeconds);
  return data?.signedUrl ?? null;
}
