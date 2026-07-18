/**
 * Manual test runner for Phase 1 extraction against a REAL receipt image or PDF.
 *
 * Usage:
 *   npm run ai:test:receipt -- "C:\path\to\receipt.jpg"
 *   npm run ai:test:receipt -- "C:\path\to\receipt.jpg" "paid using posb bank"
 *
 * The second (optional) argument is free-text capture-hint context, exactly like the
 * "Additional info" box on the Capture screen.
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { GeminiProvider } from "@/services/ai/gemini.provider";
import { extract } from "@/services/ai/phase1.extract";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".pdf": "application/pdf",
};

async function main() {
  const [filePath, freeText] = process.argv.slice(2);

  if (!filePath) {
    console.error(
      'Usage: npm run ai:test:receipt -- "C:\\path\\to\\receipt.jpg" ["optional free text"]'
    );
    process.exit(1);
  }

  const ext = extname(filePath).toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) {
    console.error(`Unsupported file type "${ext}". Supported: ${Object.keys(MIME_BY_EXT).join(", ")}`);
    process.exit(1);
  }

  const dataBase64 = readFileSync(filePath).toString("base64");
  const provider = new GeminiProvider();

  console.log(`Extracting from ${filePath} (${mimeType})${freeText ? ` + hint: "${freeText}"` : ""}...\n`);

  const { result, ocrText } = await extract(provider, {
    media: [{ mimeType, dataBase64 }],
    hints: freeText ? { freeText } : undefined,
  });

  if (mimeType !== "application/pdf") {
    console.log("--- Raw OCR text (Vision) ---");
    console.log(ocrText || "(empty)");
    console.log("");
  }

  console.log(JSON.stringify(result, null, 2));

  console.log("\n--- Sanity checks ---");
  console.log(result.merchant ? "  PASS  merchant extracted" : "  FAIL  merchant is empty");
  console.log(result.totalAmount > 0 ? "  PASS  totalAmount > 0" : "  FAIL  totalAmount is 0 or missing");
  console.log(result.lineItems.length > 0 ? `  PASS  ${result.lineItems.length} line item(s)` : "  WARN  no line items extracted");
  console.log(
    result.warnings.length > 0
      ? `  INFO  ${result.warnings.length} warning(s) — review above`
      : "  PASS  no warnings"
  );
}

void main();
