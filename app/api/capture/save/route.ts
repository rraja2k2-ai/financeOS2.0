import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase";
import { saveReviewedCapture, SaveValidationError, type ReviewedCapture, type CaptureAudit } from "@/services/capture/save-capture.service";
import type { CaptureDocumentPage } from "@/services/ai/ai-provider";

export const maxDuration = 60;

const MAX_PAGES = 8;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = (type: string) => type.startsWith("image/") || type === "application/pdf";

type SavePayload = {
  reviewed: ReviewedCapture;
  aiContext: string;
  audit: CaptureAudit;
};

/**
 * C4 save endpoint. Persists the reviewed transaction (multipart form):
 *   - "payload": JSON { reviewed, aiContext, audit }
 *   - "pages":   the original receipt page files (order preserved), re-sent from the client
 *
 * All persistence happens in the capture save service → repositories → Supabase. On
 * success the transaction is committed and Activity is revalidated so it appears at once.
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const rawPayload = form.get("payload");
  if (typeof rawPayload !== "string") {
    return NextResponse.json({ error: "Missing review payload." }, { status: 400 });
  }

  let payload: SavePayload;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return NextResponse.json({ error: "Review payload is not valid JSON." }, { status: 400 });
  }

  const files = form.getAll("pages").filter((f): f is File => f instanceof File);
  if (files.length > MAX_PAGES) {
    return NextResponse.json({ error: `A receipt can have at most ${MAX_PAGES} pages.` }, { status: 400 });
  }

  const pages: CaptureDocumentPage[] = [];
  for (const file of files) {
    if (!ALLOWED_MIME(file.type)) {
      return NextResponse.json({ error: "Only images or a PDF are supported." }, { status: 400 });
    }
    if (file.size > MAX_PAGE_BYTES) {
      return NextResponse.json({ error: "Each page must be under 8 MB." }, { status: 400 });
    }
    pages.push({ mimeType: file.type, dataBase64: Buffer.from(await file.arrayBuffer()).toString("base64") });
  }

  try {
    const supabase = await createServerSupabaseClient();
    const saved = await saveReviewedCapture(supabase, {
      reviewed: payload.reviewed,
      aiContext: payload.aiContext ?? "",
      pages,
      audit: payload.audit,
    });

    // Make the new transaction show up immediately on Activity (and the Dashboard feed).
    revalidatePath("/activity");
    revalidatePath("/");

    return NextResponse.json({ saved });
  } catch (err) {
    if (err instanceof SaveValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // Duplicate key, FK violation, network/DB failure — surface a friendly message but
    // keep the raw detail server-side for debugging.
    const code = (err as { code?: string })?.code;
    console.error("[capture/save] failed:", code, err);
    const message =
      code === "23505"
        ? "This transaction looks like it was already saved."
        : "Couldn't save the transaction. Your review is safe — please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
