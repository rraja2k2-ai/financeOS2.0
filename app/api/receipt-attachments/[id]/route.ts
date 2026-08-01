import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { receiptAttachmentRepository } from "@/repositories";

/**
 * Attachment Management MVP, Feature 2 — the single "Keep Attachment" toggle endpoint,
 * called from the Receipt Viewer (the one place a user looks at an attachment). Nothing
 * else about the attachment changes; this only flips receipt_attachments.keep_attachment.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: { keepAttachment?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (typeof body.keepAttachment !== "boolean") {
    return NextResponse.json({ error: "Missing keepAttachment." }, { status: 400 });
  }

  try {
    const supabase = await createServerSupabaseClient();
    await receiptAttachmentRepository.update(supabase, id, { keep_attachment: body.keepAttachment });
    return NextResponse.json({ updated: true });
  } catch (err) {
    console.error("[receipt-attachments/:id] PATCH failed:", { id, requested: body.keepAttachment, err });
    return NextResponse.json({ error: "Couldn't update this attachment. Try again." }, { status: 500 });
  }
}
