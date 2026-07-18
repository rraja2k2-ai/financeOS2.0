/**
 * Manual test runner for Phase 1 extraction against REAL Gemini.
 * Run: npm run ai:test:extract
 *
 * Exercises the free-text / manual-entry extraction path with synthetic fixtures.
 * The image-OCR path is validated separately with real receipt images. Prints the
 * normalized ExtractionResult for each case and a few assertions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GeminiProvider } from "@/services/ai/gemini.provider";
import { extract } from "@/services/ai/phase1.extract";
import type { ExtractionResult } from "@/types/ai";

const provider = new GeminiProvider();

const ntucReceipt = readFileSync(
  join(process.cwd(), "tests/fixtures/receipts/ntuc-groceries.txt"),
  "utf8"
);

const cases: { name: string; freeText: string; expect: (r: ExtractionResult) => string[] }[] = [
  {
    name: "Manual entry — free text only",
    freeText: "bought fish 500g 23 dollars using posb bank",
    expect: (r) => [
      check("currency SGD", r.currency === "SGD"),
      check("total 23", Math.abs(r.totalAmount - 23) < 0.5),
      check("payment hint mentions posb", (r.paymentHint ?? "").toLowerCase().includes("posb")),
      check("has >=1 line item", r.lineItems.length >= 1),
    ],
  },
  {
    name: "INR manual entry — currency inference",
    freeText: "swiggy order 680 rupees, butter chicken and 3 butter naan",
    expect: (r) => [
      check("currency INR", r.currency === "INR"),
      check("total 680", Math.abs(r.totalAmount - 680) < 1),
    ],
  },
  {
    name: "Pasted receipt text — NTUC groceries, tax EXCLUSIVE (subtotal 17.30 + GST 1.56 = 18.86)",
    freeText: ntucReceipt,
    expect: (r) => [
      check("merchant mentions fairprice", r.merchant.toLowerCase().includes("fairprice")),
      check("total 18.86", Math.abs(r.totalAmount - 18.86) < 0.02),
      check("currency SGD", r.currency === "SGD"),
      check("exactly one GST/tax line", r.lineItems.filter((i) => /\b(gst|vat|tax)\b/i.test(i.description)).length === 1),
      check("5 line items (4 real + 1 tax line)", r.lineItems.length === 5),
      check(
        "real item prices are unmodified/printed (Fresh Milk 1L = 4.50, not distributed)",
        Math.abs((r.lineItems.find((i) => /milk/i.test(i.description))?.itemTotal ?? 0) - 4.5) < 0.01
      ),
      check(
        "sum of item totals equals 18.86 exactly (items as printed + one tax line)",
        Math.abs(r.lineItems.reduce((s, i) => s + i.itemTotal, 0) - 18.86) < 0.01
      ),
      check("payment hint mentions visa", (r.paymentHint ?? "").toLowerCase().includes("visa")),
    ],
  },
];

function check(label: string, ok: boolean): string {
  return `${ok ? "  PASS" : "  FAIL"}  ${label}`;
}

async function main() {
  let anyFail = false;

  for (const c of cases) {
    console.log(`\n=== ${c.name} ===`);
    try {
      const { result } = await extract(provider, { hints: { freeText: c.freeText } });
      console.log(JSON.stringify(result, null, 2));
      const lines = c.expect(result);
      for (const line of lines) {
        if (line.startsWith("  FAIL")) anyFail = true;
        console.log(line);
      }
    } catch (err) {
      anyFail = true;
      console.error("  ERROR:", err instanceof Error ? err.message : err);
    }
  }

  console.log(anyFail ? "\nSome checks FAILED." : "\nAll checks passed.");
  process.exit(anyFail ? 1 : 0);
}

void main();
