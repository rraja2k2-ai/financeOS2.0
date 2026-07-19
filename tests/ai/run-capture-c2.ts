/**
 * Manual test runner for the C2 capture pipeline: master data (loaded once) → prompt
 * builder → active AI provider (ONE multimodal request) → normalized JSON.
 *
 * Read-only — never writes to Supabase (C2 has no persistence at all).
 *
 * Usage:
 *   npm run ai:test:capture:c2 -- "C:\path\to\receipt.jpg" [more pages...] ["context text"]
 *   npm run ai:test:capture:c2 -- "context only, no receipt"
 */
import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/config/supabase";
import { loadCaptureMasterData } from "@/services/capture/master-data.service";
import { processCapture } from "@/services/capture/capture.service";
import type { CaptureDocumentPage } from "@/services/ai/ai-provider";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

async function main() {
  const args = process.argv.slice(2);
  const pages: CaptureDocumentPage[] = [];
  const contextParts: string[] = [];

  for (const arg of args) {
    const mime = MIME_BY_EXT[extname(arg).toLowerCase()];
    if (mime && existsSync(arg)) {
      pages.push({ mimeType: mime, dataBase64: readFileSync(arg).toString("base64") });
    } else {
      contextParts.push(arg);
    }
  }

  const userContext = contextParts.join(" ");
  if (pages.length === 0 && !userContext.trim()) {
    console.error("Provide at least one receipt file or some context text.");
    process.exit(1);
  }

  const { url, anonKey } = getSupabaseConfig();
  const supabase = createClient(url, anonKey);

  console.log("[1/3] Loading master data (once per capture session)...");
  const masterData = await loadCaptureMasterData(supabase);
  console.log(
    `      base=${masterData.baseCurrency} categories=${masterData.categories.length} accounts=${masterData.accounts.length} projects=${masterData.projects.length} rules=${masterData.categorizationRules.length} accountMappingRules=${masterData.accountMappingRules.length}`
  );

  console.log(`[2/3] Processing capture (${pages.length} page(s), context: ${userContext ? `"${userContext}"` : "none"})...`);
  const started = Date.now();
  const result = await processCapture({ userContext, pages, masterData });

  console.log(`[3/3] Done in ${((Date.now() - started) / 1000).toFixed(1)}s. Result:\n`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
