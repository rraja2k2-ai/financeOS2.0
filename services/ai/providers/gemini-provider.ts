/**
 * Gemini implementation of the provider-agnostic CaptureAiProvider (C2).
 *
 * The ONLY file in the capture pipeline that imports the Gemini SDK. Uses the Google
 * AI Studio Gemini API in ONE multimodal request: prompt + all receipt pages together,
 * JSON response mode. Swapping providers later means adding a sibling file here and
 * registering it in providers/index.ts — nothing outside services/ai/providers/ changes.
 */
import { GoogleGenAI } from "@google/genai";
import type { Part } from "@google/genai";
import { getGeminiConfig } from "@/config/gemini";
import { buildReceiptProcessingPrompt } from "@/prompts/receipt-processing.prompt";
import {
  CaptureAiError,
  type CaptureAiProvider,
  type CaptureProcessingInput,
  type CaptureProcessingResult,
} from "@/services/ai/ai-provider";

/** Keep under the API route's maxDuration (60s) so we fail with a clean timeout error. */
const REQUEST_TIMEOUT_MS = 55_000;

export class GeminiCaptureProvider implements CaptureAiProvider {
  readonly name = "gemini";

  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor() {
    const { apiKey, model } = getGeminiConfig();
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async processReceipt(input: CaptureProcessingInput): Promise<CaptureProcessingResult> {
    const { system, task } = buildReceiptProcessingPrompt(input.masterData, input.userContext, input.pages.length);

    // ONE request: task text + every page of the single receipt as inline parts.
    const parts: Part[] = [{ text: task }];
    for (const page of input.pages) {
      parts.push({ inlineData: { mimeType: page.mimeType, data: page.dataBase64 } });
    }

    // Performance profiling pass (measure-only): the SDK call is one opaque network round
    // trip — request-sent vs. response-received can't be split further without
    // instrumenting the HTTP transport itself, so this times the call as a whole and logs
    // it separately from capture.service.ts's own (coarser) "Gemini Processing" stage,
    // giving the request+response vs. JSON.parse split without leaking an app-specific
    // timer type across the provider-agnostic interface.
    const callStart = performance.now();
    let text: string;
    try {
      const response = await withTimeout(
        this.client.models.generateContent({
          model: this.model,
          contents: [{ role: "user", parts }],
          config: {
            responseMimeType: "application/json",
            temperature: 0,
            systemInstruction: system,
          },
        }),
        REQUEST_TIMEOUT_MS
      );
      text = response.text ?? "";
    } catch (err) {
      if (err instanceof CaptureAiError) throw err;
      throw classifyGeminiError(err);
    }
    const callMs = performance.now() - callStart;

    if (!text.trim()) {
      throw new CaptureAiError("invalid_response", "Gemini returned an empty response.");
    }

    const parseStart = performance.now();
    let parsed: CaptureProcessingResult;
    try {
      // JSON response mode is requested, but stay defensive against stray code fences.
      parsed = JSON.parse(stripCodeFences(text));
    } catch (err) {
      throw new CaptureAiError("invalid_response", "Gemini returned invalid JSON.", err);
    }
    const parseMs = performance.now() - parseStart;

    console.log(
      `[gemini] request + response ${Math.round(callMs).toLocaleString("en-US")} ms · JSON.parse ${Math.round(parseMs).toLocaleString("en-US")} ms (response ${text.length.toLocaleString("en-US")} chars)`
    );

    return parsed;
  }
}

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CaptureAiError("timeout", `Gemini request exceeded ${ms}ms.`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Map SDK/HTTP errors to the provider-agnostic error taxonomy. */
function classifyGeminiError(err: unknown): CaptureAiError {
  const status = extractStatus(err);
  const message = err instanceof Error ? err.message : String(err);

  if (status === 429) {
    return new CaptureAiError("quota", `Gemini quota/rate limit hit: ${message}`, err);
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return new CaptureAiError("unavailable", `Gemini temporarily unavailable: ${message}`, err);
  }
  if (status === 400 || status === 401 || status === 403) {
    return new CaptureAiError("invalid_request", `Gemini rejected the request: ${message}`, err);
  }
  return new CaptureAiError("unknown", `Gemini call failed: ${message}`, err);
}

function extractStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null) {
    const anyErr = err as Record<string, unknown>;
    if (typeof anyErr.status === "number") return anyErr.status;
    if (typeof anyErr.code === "number") return anyErr.code;
    // The SDK sometimes embeds the status only in the message, e.g. "got status: 429".
    const msg = anyErr.message;
    if (typeof msg === "string") {
      const m = msg.match(/\b(4\d\d|5\d\d)\b/);
      if (m) return Number(m[1]);
    }
  }
  return undefined;
}
