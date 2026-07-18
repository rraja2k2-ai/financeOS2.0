/**
 * GeminiProvider — the ONLY file in the codebase that imports the Gemini SDK.
 * Implements the AIProvider seam (services/ai/provider.ts). Swapping models later
 * means rewriting this file and nothing else.
 */
import { GoogleGenAI } from "@google/genai";
import type { Part } from "@google/genai";
import { getGeminiConfig } from "@/config/gemini";
import {
  type AIProvider,
  type AiJsonRequest,
  type AiJsonResponse,
  AiProviderError,
} from "./provider";

export class GeminiProvider implements AIProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor() {
    const { apiKey, model } = getGeminiConfig();
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async generateJson(request: AiJsonRequest): Promise<AiJsonResponse> {
    const parts: Part[] = [{ text: request.prompt }];
    for (const media of request.media ?? []) {
      parts.push({ inlineData: { mimeType: media.mimeType, data: media.dataBase64 } });
    }

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts }],
        config: {
          responseMimeType: "application/json",
          temperature: request.temperature ?? 0,
          ...(request.system ? { systemInstruction: request.system } : {}),
        },
      });

      const text = response.text ?? "";
      if (!text.trim()) {
        throw new AiProviderError("unknown", "Gemini returned an empty response.");
      }

      return {
        text,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount,
          outputTokens: response.usageMetadata?.candidatesTokenCount,
        },
      };
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      throw classifyGeminiError(err);
    }
  }
}

/** Map SDK/HTTP errors to our retryable-aware taxonomy (TAD-005 §13). */
function classifyGeminiError(err: unknown): AiProviderError {
  const status = extractStatus(err);
  const message = err instanceof Error ? err.message : String(err);

  if (status === 429) {
    return new AiProviderError("quota", `Gemini quota/rate limit hit: ${message}`, err);
  }
  if (status === 503 || status === 500 || status === 502 || status === 504) {
    return new AiProviderError("unavailable", `Gemini temporarily unavailable: ${message}`, err);
  }
  if (status === 400 || status === 401 || status === 403) {
    return new AiProviderError("invalid_request", `Gemini rejected the request: ${message}`, err);
  }
  return new AiProviderError("unknown", `Gemini call failed: ${message}`, err);
}

function extractStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null) {
    const anyErr = err as Record<string, unknown>;
    if (typeof anyErr.status === "number") return anyErr.status;
    if (typeof anyErr.code === "number") return anyErr.code;
    // SDK sometimes embeds the status in the message, e.g. "got status: 429".
    const msg = anyErr.message;
    if (typeof msg === "string") {
      const m = msg.match(/\b(4\d\d|5\d\d)\b/);
      if (m) return Number(m[1]);
    }
  }
  return undefined;
}
