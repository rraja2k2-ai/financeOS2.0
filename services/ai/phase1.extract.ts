/**
 * Phase 1 — Extraction service (TAD-005 §5b).
 *
 * Turns a capture (receipt/PDF image(s) and/or free-text note) into an ExtractionResult
 * of FACTS ONLY. No categories, no UUIDs, no persistence. The AIProvider is injected so
 * this is unit-testable with a stub and swappable at the model layer.
 *
 * Two-project cost isolation: images are OCR'd via Google Cloud Vision first
 * (vision-ocr.provider.ts, billed to a separate Vision-only project), then the
 * resulting TEXT — never the image — goes to Gemini (free-tier project). This keeps
 * Gemini calls text-only/small so OCR volume doesn't eat its free daily quota. PDFs
 * are the exception: Vision's synchronous endpoint doesn't handle PDF the same way as
 * images, so PDFs still go directly to Gemini as multimodal input.
 */
import type { AIProvider, AiMediaPart } from "./provider";
import { loadPrompt } from "./prompt.loader";
import { parseModelJson } from "./json";
import { extractTextFromImage } from "./vision-ocr.provider";
import type { CaptureHints, ExtractionResult, ExtractedLineItem, TransactionType } from "@/types/ai";

const TRANSACTION_TYPES: TransactionType[] = ["Expense", "Payment", "Transfer", "Lending"];

export type ExtractionInput = {
  media?: AiMediaPart[];
  hints?: CaptureHints;
};

export type ExtractionOutcome = {
  result: ExtractionResult;
  /** Raw OCR text (empty string if this was a manual/free-text-only or PDF-only capture). Store on receipt_attachments.ocr_raw_text. */
  ocrText: string;
};

export async function extract(provider: AIProvider, input: ExtractionInput): Promise<ExtractionOutcome> {
  const media = input.media ?? [];
  const images = media.filter((m) => m.mimeType.startsWith("image/"));
  const pdfs = media.filter((m) => m.mimeType === "application/pdf");

  const ocrTexts = await Promise.all(images.map((img) => extractTextFromImage(img)));
  const documentText = ocrTexts
    .map((r, i) => (ocrTexts.length > 1 ? `--- Page ${i + 1} ---\n${r.text}` : r.text))
    .join("\n\n")
    .trim();

  const { system, user } = loadPrompt("phase1/extract.md", {
    DOCUMENT_TEXT: documentText,
    FREE_TEXT: input.hints?.freeText?.trim() ?? "",
  });

  const response = await provider.generateJson({
    system,
    prompt: user,
    media: pdfs.length > 0 ? pdfs : undefined,
    temperature: 0,
  });

  const parsed = parseModelJson<Record<string, unknown>>(response.text);
  return { result: normalizeExtraction(parsed), ocrText: documentText };
}

/**
 * Coerce the model's JSON into a well-formed ExtractionResult. Defensive: models can
 * omit fields or return strings for numbers. We normalize rather than trust, and record
 * anything suspicious in warnings — but we do not invent merchant/amount values.
 */
export function normalizeExtraction(raw: Record<string, unknown>): ExtractionResult {
  const warnings = toStringArray(raw.warnings);

  const lineItems = Array.isArray(raw.lineItems)
    ? raw.lineItems.map((it) => normalizeLineItem(it as Record<string, unknown>))
    : [];

  const currency = typeof raw.currency === "string" && raw.currency.trim()
    ? raw.currency.trim().toUpperCase()
    : "SGD";
  if (!raw.currency) warnings.push("Currency was missing; defaulted to SGD.");

  const totalAmount = toNumber(raw.totalAmount) ?? 0;

  // Consistency check (server-side, deterministic — never trust the model's own math).
  const itemsSum = lineItems.reduce((sum, it) => sum + it.itemTotal, 0);
  if (lineItems.length > 0 && Math.abs(itemsSum - totalAmount) > 0.02) {
    warnings.push(
      `Sum of line items (${itemsSum.toFixed(2)}) differs from total (${totalAmount.toFixed(2)}).`
    );
  }

  const transactionType = TRANSACTION_TYPES.includes(raw.transactionType as TransactionType)
    ? (raw.transactionType as TransactionType)
    : "Expense";

  return {
    merchant: typeof raw.merchant === "string" ? raw.merchant.trim() : "",
    transactionDate: normalizeDate(raw.transactionDate),
    currency,
    totalAmount,
    transactionType,
    paymentHint: nonEmptyString(raw.paymentHint),
    projectHint: nonEmptyString(raw.projectHint),
    lineItems,
    confidence: clampConfidence(raw.confidence),
    warnings,
  };
}

function normalizeLineItem(raw: Record<string, unknown>): ExtractedLineItem {
  return {
    description: typeof raw.description === "string" ? raw.description.trim() : "",
    qty: typeof raw.qty === "string" && raw.qty.trim() ? raw.qty.trim() : "1",
    unitPrice: toNumber(raw.unitPrice),
    itemTotal: toNumber(raw.itemTotal) ?? 0,
  };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.\-]/g, "");
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function clampConfidence(value: unknown): number {
  const n = toNumber(value);
  if (n === null) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}
