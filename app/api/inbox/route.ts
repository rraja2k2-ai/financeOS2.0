import { NextRequest, NextResponse, after } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { enqueueCapture, processQueueItem, listInboxItems } from "@/services/capture/inbox.service";
import type { CaptureDocumentPage } from "@/services/ai/ai-provider";
import type { CaptureSourceKind } from "@/domain/capture-queue";
import { createStageTimer } from "@/lib/perf-timer";

export const maxDuration = 60;

const MAX_PAGES = 8;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = (type: string) => type.startsWith("image/") || type === "application/pdf";
const ALLOWED_SOURCES: CaptureSourceKind[] = ["camera", "upload", "paste", "prompt"];

/**
 * C5 enqueue endpoint. Accepts the same multipart shape as /api/capture/process
 * ("context" + "pages" files), uploads the pages to Storage, creates the queue row, and
 * responds IMMEDIATELY — the AI pipeline then runs in the background via after(), so the
 * user keeps using FinanceOS while the receipt is processed.
 */
export async function POST(req: NextRequest) {
  // Performance profiling pass (measure-only): one timer per capture, created here and
  // carried through enqueue AND the background processQueueItem() run via after() — Next's
  // after() continues in the SAME server invocation after the response is sent, so this
  // one timer captures the full, real end-to-end pipeline (upload through save) in a
  // single unified report. See lib/perf-timer.ts.
  const timer = createStageTimer();

  let form: FormData;
  try {
    form = await timer.time("Request Body Received (multipart upload)", () => req.formData());
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const context = typeof form.get("context") === "string" ? (form.get("context") as string) : "";
  const rawSource = form.get("source");
  const source: CaptureSourceKind = ALLOWED_SOURCES.includes(rawSource as CaptureSourceKind) ? (rawSource as CaptureSourceKind) : "prompt";
  const files = form.getAll("pages").filter((f): f is File => f instanceof File);

  if (files.length === 0 && !context.trim()) {
    return NextResponse.json({ error: "Attach a receipt or enter some context first." }, { status: 400 });
  }
  if (files.length > MAX_PAGES) {
    return NextResponse.json({ error: `A receipt can have at most ${MAX_PAGES} pages.` }, { status: 400 });
  }

  // Timed with mark() rather than timer.time() — this loop can return early from the
  // enclosing POST handler (validation failures), which a wrapped async closure can't do.
  const pages: CaptureDocumentPage[] = [];
  const conversionStart = performance.now();
  for (const file of files) {
    if (!ALLOWED_MIME(file.type)) {
      return NextResponse.json({ error: "Only images or a PDF are supported." }, { status: 400 });
    }
    if (file.size > MAX_PAGE_BYTES) {
      return NextResponse.json({ error: "Each page must be under 8 MB." }, { status: 400 });
    }
    pages.push({ mimeType: file.type, dataBase64: Buffer.from(await file.arrayBuffer()).toString("base64") });
  }
  timer.mark(`Multipart → Base64 Conversion (${pages.length} page${pages.length === 1 ? "" : "s"})`, performance.now() - conversionStart);

  try {
    const supabase = await createServerSupabaseClient();
    const item = await enqueueCapture(supabase, { userContext: context.trim(), pages, source }, timer);

    // Background processing — continues after this response is sent, same timer/report.
    after(() => processQueueItem(item.id, timer));

    return NextResponse.json({ id: item.id });
  } catch (err) {
    console.error("[inbox] enqueue failed:", err);
    timer.report("[capture] Pipeline timing (enqueue failed — never reached background processing)");
    return NextResponse.json({ error: "Couldn't add the capture to the Inbox. Try again." }, { status: 500 });
  }
}

/** Lightweight queue listing for the Inbox indicator (statuses only, no AI results). */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const items = await listInboxItems(supabase);
    return NextResponse.json({
      items: items.map((i) => ({ id: i.id, status: i.status, merchant: i.merchant, transactionHeaderId: i.transactionHeaderId })),
    });
  } catch (err) {
    // Most likely migration 013 hasn't been run yet — report empty rather than erroring the shell.
    console.error("[inbox] list failed:", err);
    return NextResponse.json({ items: [] });
  }
}
