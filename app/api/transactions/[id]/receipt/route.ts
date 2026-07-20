import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { receiptAttachmentRepository, receiptStorageRepository } from "@/repositories";

/**
 * Receipt Viewer (UX refresh Phase D) — read-only, sub-resource of an existing
 * transaction, same pattern as /api/inbox/[id]/retry and /save. Reuses the stored
 * original file untouched: no thumbnails, no derived copies, no schema change.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const supabase = await createServerSupabaseClient();
    const attachments = await receiptAttachmentRepository.listByHeaderId(supabase, id);

    const pages = await Promise.all(
      attachments
        .filter((a) => a.storage_path)
        .map(async (a) => ({
          url: await receiptStorageRepository.getSignedUrl(supabase, a.storage_path as string),
          mimeType: a.mime_type ?? "application/octet-stream",
          pageNo: a.page_no ?? 1,
        }))
    );

    return NextResponse.json({ pages: pages.filter((p) => p.url !== null) });
  } catch (err) {
    console.error("[transactions/:id/receipt] GET failed:", err);
    return NextResponse.json({ error: "Couldn't load the receipt. Try again." }, { status: 500 });
  }
}
