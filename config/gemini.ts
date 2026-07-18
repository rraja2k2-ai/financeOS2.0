/**
 * Gemini configuration. Server-side only — GEMINI_API_KEY must never be exposed to
 * the client (it is not NEXT_PUBLIC_ prefixed, so Next.js keeps it server-only).
 *
 * Set locally in .env.local, and in Vercel → Project Settings → Environment Variables
 * before deploying. Nothing else in the codebase reads this key directly — only the
 * GeminiProvider (services/ai/gemini.provider.ts) does, per the provider abstraction.
 */

export type GeminiConfig = {
  apiKey: string;
  /** Model id. Gemini 2.5 Flash per TAD-001 approved stack. */
  model: string;
};

const DEFAULT_MODEL = "gemini-2.5-flash";

export function getGeminiConfig(): GeminiConfig {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      `[FinanceOS] Missing required environment variable "GEMINI_API_KEY". ` +
        `Get a key from https://aistudio.google.com/apikey and add it to .env.local ` +
        `(and to Vercel env vars before deploying).`
    );
  }

  return {
    apiKey,
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
  };
}
