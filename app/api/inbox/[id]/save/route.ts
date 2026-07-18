import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase";
import { captureQueueRepository } from "@/repositories";
import { saveReviewedCapture, SaveValidationError, type ReviewedCapture } from "@/services/capture/save-capture.service";

export const maxDuration = 60;

/**
 * Save endpoint for Inbox items. The receipt pages are ALREADY in Storage (uploaded at
 * enqueue time), so this takes only the reviewed JSON, persists the transaction via the
 * existing save service (referencing the stored pages) unchanged, then marks the queue
 * row Saved and stamps transaction_header_id — pages/result_json/merchant are left as-is
 * per the frozen schema's save contract. The row stays in the Inbox (status=Saved) rather
 * than being deleted. On failure the queue row is untouched — the capture stays Ready for
 * Review, and the Review data isn't lost.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: { reviewed?: ReviewedCapture };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (!body.reviewed) {
    return NextResponse.json({ error: "Missing review payload." }, { status: 400 });
  }

  try {
    const supabase = await createServerSupabaseClient();

    const row = await captureQueueRepository.getById(supabase, id);
    if (!row) {
      return NextResponse.json({ error: "This capture no longer exists." }, { status: 404 });
    }
    if (row.status !== "Ready for Review") {
      return NextResponse.json({ error: "This capture isn't ready to save yet." }, { status: 409 });
    }

    const saved = await saveReviewedCapture(supabase, {
      reviewed: body.reviewed,
      aiContext: row.user_context,
      pages: [],
      preUploadedPages: [...row.pages]
        .sort((a, b) => a.pageNo - b.pageNo)
        .map((p) => ({ storagePath: p.storagePath, mimeType: p.mimeType, fileSizeBytes: p.fileSizeBytes })),
      audit: { aiProvider: row.ai_provider, processedAt: row.updated_at, captureSource: row.capture_source },
    });

    // Saved — mark the queue row Saved and link it to the new transaction. Only these
    // fields change (pages/result_json/merchant are untouched, per the frozen schema's
    // save contract); the Storage files stay in place — receipt_attachments now
    // references them as the transaction's permanent receipt.
    await captureQueueRepository.update(supabase, id, { status: "Saved", transaction_header_id: saved.headerId });

    revalidatePath("/activity");
    revalidatePath("/");

    return NextResponse.json({ saved });
  } catch (err) {
    if (err instanceof SaveValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const code = (err as { code?: string })?.code;
    console.error("[inbox/save] failed:", code, err);
    const message =
      code === "23505"
        ? "This transaction looks like it was already saved."
        : "Couldn't save the transaction. Your review is safe — please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
