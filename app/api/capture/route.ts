import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { GeminiProvider } from "@/services/ai/gemini.provider";
import { captureTransaction } from "@/services/transaction/capture-transaction.usecase";
import { AiProviderError } from "@/services/ai/provider";

export const maxDuration = 60;

type CaptureRequestBody = {
  mimeType?: string;
  dataBase64?: string;
  freeText?: string;
};

export async function POST(req: NextRequest) {
  let body: CaptureRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { mimeType, dataBase64, freeText } = body;

  if (!dataBase64 && !freeText?.trim()) {
    return NextResponse.json({ error: "Provide an image (mimeType + dataBase64) and/or freeText." }, { status: 400 });
  }

  try {
    const supabase = await createServerSupabaseClient();
    const provider = new GeminiProvider();

    const result = await captureTransaction(
      supabase,
      provider,
      {
        media: mimeType && dataBase64 ? [{ mimeType, dataBase64 }] : undefined,
        hints: freeText?.trim() ? { freeText: freeText.trim() } : undefined,
      },
      { dryRun: false }
    );

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AiProviderError) {
      const status = err.kind === "quota" ? 429 : err.kind === "invalid_request" ? 400 : 502;
      return NextResponse.json({ error: err.message, kind: err.kind, retryable: err.retryable }, { status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
