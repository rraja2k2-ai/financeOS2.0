import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { loadCaptureMasterData } from "@/services/capture/master-data.service";
import { processCapture } from "@/services/capture/capture.service";
import { getActiveCaptureProviderName } from "@/services/ai/providers";
import { CaptureAiError, friendlyCaptureError, type CaptureDocumentPage } from "@/services/ai/ai-provider";

export const maxDuration = 60;

const MAX_PAGES = 8;
const MAX_PAGE_BYTES = 8 * 1024 * 1024; // 8 MB per page
const ALLOWED_MIME = (type: string) => type.startsWith("image/") || type === "application/pdf";

/**
 * C2 capture processing endpoint. Accepts multipart/form-data:
 *   - "context": free-text AI context (may be empty)
 *   - "pages":   0..n files — all pages of ONE receipt (images and/or one PDF)
 *
 * Loads master data ONCE for the capture session, runs the provider-agnostic pipeline,
 * and returns the structured JSON. No persistence — the client shows a developer viewer.
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const context = typeof form.get("context") === "string" ? (form.get("context") as string) : "";
  const files = form.getAll("pages").filter((f): f is File => f instanceof File);

  if (files.length === 0 && !context.trim()) {
    return NextResponse.json({ error: "Attach a receipt or enter some context first." }, { status: 400 });
  }
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
    pages.push({
      mimeType: file.type,
      dataBase64: Buffer.from(await file.arrayBuffer()).toString("base64"),
    });
  }

  // Response metadata for the temporary Developer Viewer (C2.1) — not pipeline logic.
  const provider = getActiveCaptureProviderName();
  const startedAt = Date.now();
  const meta = () => ({ provider, durationMs: Date.now() - startedAt });

  try {
    const supabase = await createServerSupabaseClient();
    // Master data is loaded ONCE here and reused for the entire capture session — the
    // AI layer and capture service never touch the database themselves.
    const masterData = await loadCaptureMasterData(supabase);

    const result = await processCapture({ userContext: context, pages, masterData });
    // masterData rides along so the Review screen can populate its dropdowns from the
    // SAME session load — the client never has to query for it again.
    return NextResponse.json({ result, masterData, meta: meta() });
  } catch (err) {
    if (err instanceof CaptureAiError) {
      const status = err.kind === "quota" ? 429 : err.kind === "invalid_request" ? 400 : err.kind === "timeout" ? 504 : 502;
      console.error(`[capture/process] ${err.kind}: ${err.message}`);
      return NextResponse.json({ error: friendlyCaptureError(err), kind: err.kind, meta: meta() }, { status });
    }
    console.error("[capture/process] unexpected:", err);
    return NextResponse.json({ error: friendlyCaptureError(err), meta: meta() }, { status: 500 });
  }
}
