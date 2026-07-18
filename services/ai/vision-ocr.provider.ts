/**
 * Google Cloud Vision OCR — the ONLY file that calls the Vision API. Pure text
 * extraction from an image/PDF page, nothing more: no understanding, no structure,
 * no categorization. That's Gemini's job (phase1.extract.ts), fed this raw text
 * instead of the image itself, per the two-project cost-isolation design (see
 * config/google-vision.ts) — keeps Gemini calls text-only and small, so OCR volume
 * is billed to the cheap Vision project instead of eating Gemini's free daily quota.
 *
 * Uses the plain REST endpoint with an API key (not the Node client library, which
 * expects a service-account credential) — consistent with keeping this a simple,
 * dependency-light call.
 */
import { getGoogleVisionConfig } from "@/config/google-vision";
import { AiProviderError } from "./provider";

const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

export type OcrInput = {
  mimeType: string;
  dataBase64: string;
};

export type OcrResult = {
  /** Full extracted text, reading order preserved as best Vision can. */
  text: string;
};

export async function extractTextFromImage(input: OcrInput): Promise<OcrResult> {
  const { apiKey } = getGoogleVisionConfig();

  const response = await fetch(`${VISION_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: input.dataBase64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw classifyVisionError(response.status, body);
  }

  const json = await response.json();
  const result = json?.responses?.[0];

  if (result?.error) {
    throw new AiProviderError("invalid_request", `Vision API error: ${result.error.message}`, result.error);
  }

  const text = result?.fullTextAnnotation?.text ?? "";
  return { text };
}

function classifyVisionError(status: number, body: string): AiProviderError {
  if (status === 429) {
    return new AiProviderError("quota", `Vision API quota/rate limit hit: ${body}`);
  }
  if (status >= 500) {
    return new AiProviderError("unavailable", `Vision API temporarily unavailable: ${body}`);
  }
  if (status === 400 || status === 401 || status === 403) {
    return new AiProviderError("invalid_request", `Vision API rejected the request: ${body}`);
  }
  return new AiProviderError("unknown", `Vision API call failed (${status}): ${body}`);
}
