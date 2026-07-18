/**
 * Manual test runner for Phase 1 -> Phase 2 (extraction -> classification) against
 * REAL Gemini and REAL Supabase account/project data (read-only).
 *
 * Usage:
 *   npm run ai:test:classify
 *   npm run ai:test:classify -- "C:\path\to\receipt.jpg"
 *
 * With no argument, classifies the NTUC groceries text fixture. With a file path,
 * runs OCR extraction on that image/PDF first, then classifies the result.
 */
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/config/supabase";
import { GeminiProvider } from "@/services/ai/gemini.provider";
import { extract } from "@/services/ai/phase1.extract";
import { classify } from "@/services/ai/phase2.classify";
import { buildClassificationContext } from "@/services/ai/context.builder";
import { isKnownCategory } from "@/constants/categories";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".pdf": "application/pdf",
};

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

function check(label: string, ok: boolean): string {
  return `${ok ? "  PASS" : "  FAIL"}  ${label}`;
}

async function main() {
  const filePath = process.argv[2];
  const provider = new GeminiProvider();
  const { url, anonKey } = getSupabaseConfig();
  const supabase = createClient(url, anonKey);

  console.log("Loading account/project context from Supabase...");
  const context = await buildClassificationContext(supabase);
  console.log(`  ${context.accountNames.length} active accounts, ${context.projectNames.length} active projects, ${context.categories.length} expense categories\n`);

  let extraction;
  if (filePath) {
    const ext = extname(filePath).toLowerCase();
    const mimeType = MIME_BY_EXT[ext];
    if (!mimeType) {
      console.error(`Unsupported file type "${ext}".`);
      process.exit(1);
    }
    const dataBase64 = readFileSync(filePath).toString("base64");
    console.log(`Extracting from ${filePath}...`);
    ({ result: extraction } = await extract(provider, { media: [{ mimeType, dataBase64 }] }));
  } else {
    const text = readFileSync(join(process.cwd(), "tests/fixtures/receipts/ntuc-groceries.txt"), "utf8");
    console.log("Extracting from tests/fixtures/receipts/ntuc-groceries.txt...");
    ({ result: extraction } = await extract(provider, { hints: { freeText: text } }));
  }

  console.log("\n=== Extraction ===");
  console.log(JSON.stringify(extraction, null, 2));

  console.log("\nClassifying...");
  const classification = await classify(provider, extraction, context);

  console.log("\n=== Classification ===");
  console.log(JSON.stringify(classification, null, 2));

  console.log("\n--- Checks ---");
  let anyFail = false;
  const record = (line: string) => {
    if (line.startsWith("  FAIL")) anyFail = true;
    console.log(line);
  };

  record(check("no UUIDs anywhere in output", !UUID_RE.test(JSON.stringify(classification))));
  record(check("header category recognized", isKnownCategory(classification.headerPrimaryCategory)));
  record(check(`item count matches (${classification.items.length}/${extraction.lineItems.length})`, classification.items.length === extraction.lineItems.length));

  classification.items.forEach((item, i) => {
    record(
      check(
        `item ${i + 1} "${extraction.lineItems[i]?.description}" -> ${item.primaryCategory} / ${item.secondaryCategory ?? "—"}`,
        isKnownCategory(item.primaryCategory, item.secondaryCategory ?? undefined)
      )
    );
  });

  record(
    check(
      `suggested account is a real account name or null (got: ${classification.suggestedAccountName ?? "null"})`,
      classification.suggestedAccountName === null || context.accountNames.includes(classification.suggestedAccountName)
    )
  );

  console.log(anyFail ? "\nSome checks FAILED." : "\nAll checks passed.");
  process.exit(anyFail ? 1 : 0);
}

void main();
