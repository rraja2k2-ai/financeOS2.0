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
    const updated = await receiptAttachmentRepository.update(supabase, id, { keep_attachment: body.keepAttachment });
    // TEMPORARY diagnostic logging (Keep Attachment flicker investigation) — remove once
    // the root cause is confirmed against the live deployment (check Vercel function logs).
    console.log("[receipt-attachments/:id] PATCH ok", { id, requested: body.keepAttachment, rowReturned: updated?.keep_attachment });
    return NextResponse.json({ updated: true });
  } catch (err) {
    // Logs the RAW error (not just a generic message) — if this is still an RLS policy
    // gap, Postgres/PostgREST's own message ("new row violates row-level security
    // policy...") will appear here in Vercel's function logs.
    console.error("[receipt-attachments/:id] PATCH failed:", { id, requested: body.keepAttachment, err });

    // TEMPORARY (Keep Attachment flicker investigation): surface the raw Postgres/
    // PostgREST error details in the response itself, not just server logs, since Vercel
    // function logs aren't always at hand. Remove this detail field once root-caused —
    // a generic message is the right long-term behavior for a client-facing error.
    const e = err as { message?: string; details?: string; hint?: string; code?: string } | null;
    const detail = e ? [e.code, e.message, e.details, e.hint].filter(Boolean).join(" | ") : String(err);
    return NextResponse.json({ error: "Couldn't update this attachment. Try again.", detail }, { status: 500 });
  }
}
