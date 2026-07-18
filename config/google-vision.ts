/**
 * Google Cloud Vision configuration. Server-only — GOOGLE_CLOUD_VISION_API_KEY must
 * never reach the client. Deliberately a SEPARATE Google Cloud project/key from
 * Gemini (config/gemini.ts): Vision is on a billing-enabled project (1000 free
 * pages/month, then pennies from the linked prepayment), Gemini stays on a
 * billing-disabled free-tier project. Mixing them onto one project would let OCR
 * volume eat into Gemini's free daily quota instead of the cheap Vision quota.
 */

export type GoogleVisionConfig = {
  apiKey: string;
};

export function getGoogleVisionConfig(): GoogleVisionConfig {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      `[FinanceOS] Missing required environment variable "GOOGLE_CLOUD_VISION_API_KEY". ` +
        `Create a Google Cloud project with the Cloud Vision API enabled and billing linked, ` +
        `generate an API key, and add it to .env.local (and Vercel env vars before deploying).`
    );
  }

  return { apiKey };
}
