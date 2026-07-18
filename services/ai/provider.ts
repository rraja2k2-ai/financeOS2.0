/**
 * AI provider abstraction (TAD-005 §17).
 *
 * A deliberately thin seam: one method that takes a multimodal prompt and returns
 * raw JSON text. Prompts, schemas, verification and phase semantics live in the
 * phase services (phase1.extract.ts, phase2.classify.ts) — NOT here — so switching
 * models later is a contained change to the provider implementation only. Nothing
 * outside services/ai/gemini.provider.ts imports the Gemini SDK.
 */

export type AiMediaPart = {
  /** e.g. "image/jpeg", "image/png", "application/pdf" */
  mimeType: string;
  /** base64-encoded bytes, without the data: URI prefix */
  dataBase64: string;
};

export type AiJsonRequest = {
  /** System instruction — role, rules, output contract. */
  system?: string;
  /** The task prompt text. */
  prompt: string;
  /** Optional images / PDF for OCR-style extraction. */
  media?: AiMediaPart[];
  /** 0 = deterministic. Extraction/classification want low temperature. */
  temperature?: number;
};

export type AiUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type AiJsonResponse = {
  /** Raw model text — expected to be JSON (provider requests JSON mime type). */
  text: string;
  usage?: AiUsage;
};

export interface AIProvider {
  /** Generate a structured JSON response. Throws AiProviderError on failure. */
  generateJson(request: AiJsonRequest): Promise<AiJsonResponse>;
}

export type AiErrorKind =
  | "quota" // rate-limited / quota exhausted — retryable after backoff (TAD-005 §13)
  | "unavailable" // network / service outage — retryable
  | "invalid_request" // our request was malformed — not retryable
  | "unknown";

export class AiProviderError extends Error {
  readonly kind: AiErrorKind;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(kind: AiErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "AiProviderError";
    this.kind = kind;
    this.retryable = kind === "quota" || kind === "unavailable";
    this.cause = cause;
  }
}
