/**
 * Smoke test for Gemini connectivity. Mirrors verify-supabase-connection.mjs.
 * Run: npm run ai:verify   (loads .env.local via --env-file)
 *
 * Confirms GEMINI_API_KEY is set, the model responds, and JSON mode works — before
 * building the extraction pipeline on top. Does NOT touch Supabase or any real data.
 */
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY?.trim();
const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

if (!apiKey) {
  console.error(
    "[FinanceOS] Missing GEMINI_API_KEY.\n" +
      "Add it to .env.local (get a key at https://aistudio.google.com/apikey).\n" +
      "Run: npm run ai:verify"
  );
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

try {
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              'Return ONLY this JSON, nothing else: {"ok": true, "app": "FinanceOS"}',
          },
        ],
      },
    ],
    config: { responseMimeType: "application/json", temperature: 0 },
  });

  const text = (response.text ?? "").trim();
  if (!text) {
    console.error("[FinanceOS] Gemini returned an empty response.");
    process.exit(1);
  }

  const parsed = JSON.parse(text);
  if (parsed?.ok !== true) {
    console.error("[FinanceOS] Unexpected Gemini JSON:", text);
    process.exit(1);
  }

  console.log("[FinanceOS] Gemini connection verified successfully.");
  console.log(`  Model: ${model}`);
  console.log(
    `  Tokens: in=${response.usageMetadata?.promptTokenCount ?? "?"} out=${response.usageMetadata?.candidatesTokenCount ?? "?"}`
  );
} catch (err) {
  console.error("[FinanceOS] Gemini connection failed:", err?.message ?? err);
  process.exit(1);
}
