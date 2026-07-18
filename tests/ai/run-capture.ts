/**
 * Manual test runner for the full CaptureTransaction use case: Extract -> Verify ->
 * Classify -> Match account/project -> Convert to SGD -> Duplicate check -> Build ->
 * (optionally) Save.
 *
 * DRY RUN BY DEFAULT — does not write to Supabase. Pass --save to actually persist
 * (requires migration 005_atomic_save_transaction.sql to have been run first).
 *
 * Usage:
 *   npm run ai:test:capture -- "C:\path\to\receipt.jpg"
 *   npm run ai:test:capture -- "C:\path\to\receipt.jpg" --save
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/config/supabase";
import { GeminiProvider } from "@/services/ai/gemini.provider";
import { captureTransaction } from "@/services/transaction/capture-transaction.usecase";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".pdf": "application/pdf",
};

async function main() {
  const args = process.argv.slice(2);
  const save = args.includes("--save");
  const filePath = args.find((a) => !a.startsWith("--"));

  if (!filePath) {
    console.error('Usage: npm run ai:test:capture -- "C:\\path\\to\\receipt.jpg" [--save]');
    process.exit(1);
  }

  const ext = extname(filePath).toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) {
    console.error(`Unsupported file type "${ext}".`);
    process.exit(1);
  }

  const dataBase64 = readFileSync(filePath).toString("base64");
  const provider = new GeminiProvider();
  const { url, anonKey } = getSupabaseConfig();
  const supabase = createClient(url, anonKey);

  console.log(save ? "*** --save passed: THIS WILL WRITE TO SUPABASE ***\n" : "Dry run (no database writes)\n");

  const result = await captureTransaction(
    supabase,
    provider,
    { media: [{ mimeType, dataBase64 }] },
    { dryRun: !save }
  );

  console.log("=== Payload to save ===");
  console.log(JSON.stringify(result.payload, null, 2));

  console.log("\n=== Matching ===");
  console.log(`  Account:  ${result.accountMatch.account?.account_name ?? "null"}${result.accountMatch.note ? ` (${result.accountMatch.note})` : ""}`);
  console.log(`  Project:  ${result.projectMatch.project?.project_name ?? "null"}${result.projectMatch.note ? ` (${result.projectMatch.note})` : ""}`);

  console.log("\n=== Verification ===");
  console.log(`  Total check: items=${result.totalCheck.itemsSum} total=${result.totalCheck.totalAmount} matches=${result.totalCheck.matches}`);
  console.log(`  Duplicate check: ${result.duplicateCheck.isDuplicate ? `POSSIBLE DUPLICATE (${result.duplicateCheck.possibleDuplicates.length} found)` : "none found"}`);

  console.log("\n=== Outcome ===");
  console.log(`  needsReview: ${result.needsReview}  (${result.needsReview ? "would surface in Needs You" : "would auto-save silently"})`);
  if (result.warnings.length) {
    console.log("  Warnings:");
    result.warnings.forEach((w) => console.log(`    - ${w}`));
  } else {
    console.log("  No warnings.");
  }

  if (result.saved) {
    console.log("\n=== SAVED ===");
    console.log(`  header.id: ${result.saved.header.id}`);
    console.log(`  receipt_id: ${result.saved.header.receipt_id}`);
    console.log(`  items saved: ${result.saved.items.length}`);
  } else {
    console.log("\n(Dry run — nothing was written. Pass --save to persist for real.)");
  }
}

void main();
