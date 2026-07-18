/**
 * Combined Extraction + Classification — ONE Gemini call instead of two (phase1.extract.ts
 * + phase2.classify.ts combined, see prompts/combined/extract-and-classify.md for why).
 * Returns the exact same ExtractionResult/ClassificationResult shapes those two produce,
 * so every downstream consumer (transaction.builder, verifiers, matchers) is unaffected —
 * only the number of Gemini round-trips changed. This is what the real capture flow uses;
 * phase1.extract.ts/phase2.classify.ts remain available standalone for debugging.
 */
import type { AIProvider } from "./provider";
import { loadPrompt } from "./prompt.loader";
import { parseModelJson } from "./json";
import { extractTextFromImage } from "./vision-ocr.provider";
import { validateClassification } from "./response.validator";
import type { ClassificationContext } from "./context.builder";
import type {
  CaptureHints,
  ExtractionResult,
  ClassificationResult,
  ExtractedLineItem,
  ItemClassification,
  TransactionType,
} from "@/types/ai";
import type { AiMediaPart } from "./provider";

const TRANSACTION_TYPES: TransactionType[] = ["Expense", "Payment", "Transfer", "Lending"];

export type CombinedInput = {
  media?: AiMediaPart[];
  hints?: CaptureHints;
};

export type CombinedOutcome = {
  extraction: ExtractionResult;
  classification: ClassificationResult;
  ocrText: string;
};

export async function extractAndClassify(
  provider: AIProvider,
  input: CombinedInput,
  context: ClassificationContext
): Promise<CombinedOutcome> {
  const media = input.media ?? [];
  const images = media.filter((m) => m.mimeType.startsWith("image/"));
  const pdfs = media.filter((m) => m.mimeType === "application/pdf");

  const ocrTexts = await Promise.all(images.map((img) => extractTextFromImage(img)));
  const documentText = ocrTexts
    .map((r, i) => (ocrTexts.length > 1 ? `--- Page ${i + 1} ---\n${r.text}` : r.text))
    .join("\n\n")
    .trim();

  const { system, user } = loadPrompt("combined/extract-and-classify.md", {
    CATEGORY_LIST: context.categories.map((c) => `- ${c.primary}: ${c.subcategories.join(", ")}`).join("\n"),
    ACCOUNT_LIST: context.accountNames.length ? context.accountNames.join("\n") : "(none)",
    PROJECT_LIST: context.projectNames.length ? context.projectNames.join("\n") : "(none)",
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
  const { extraction, classification } = splitCombinedResult(parsed);

  return { extraction, classification: validateClassification(classification), ocrText: documentText };
}

function splitCombinedResult(raw: Record<string, unknown>): {
  extraction: ExtractionResult;
  classification: ClassificationResult;
} {
  const warnings = toStringArray(raw.warnings);
  const confidence = clampConfidence(raw.confidence);

  const rawItems = Array.isArray(raw.lineItems) ? raw.lineItems : [];

  const lineItems: ExtractedLineItem[] = rawItems.map((it) => normalizeLineItem(it as Record<string, unknown>));
  const classificationItems: ItemClassification[] = rawItems.map((it) =>
    normalizeItemClassification(it as Record<string, unknown>)
  );

  const currency = typeof raw.currency === "string" && raw.currency.trim() ? raw.currency.trim().toUpperCase() : "SGD";
  if (!raw.currency) warnings.push("Currency was missing; defaulted to SGD.");

  const totalAmount = toNumber(raw.totalAmount) ?? 0;

  // Deterministic server-side reconciliation — never trust the model's own arithmetic claim.
  const itemsSum = lineItems.reduce((sum, it) => sum + it.itemTotal, 0);
  if (lineItems.length > 0 && Math.abs(itemsSum - totalAmount) > 0.02) {
    warnings.push(`Sum of line items (${itemsSum.toFixed(2)}) differs from total (${totalAmount.toFixed(2)}).`);
  }

  const transactionType = TRANSACTION_TYPES.includes(raw.transactionType as TransactionType)
    ? (raw.transactionType as TransactionType)
    : "Expense";

  const extraction: ExtractionResult = {
    merchant: typeof raw.merchant === "string" ? raw.merchant.trim() : "",
    transactionDate: normalizeDate(raw.transactionDate),
    currency,
    totalAmount,
    transactionType,
    paymentHint: nonEmptyString(raw.paymentHint),
    projectHint: nonEmptyString(raw.projectHint),
    lineItems,
    confidence,
    warnings,
  };

  const classification: ClassificationResult = {
    headerPrimaryCategory: typeof raw.headerPrimaryCategory === "string" ? raw.headerPrimaryCategory.trim() : "",
    items: classificationItems,
    suggestedAccountName: nonEmptyString(raw.suggestedAccountName),
    suggestedProjectName: nonEmptyString(raw.suggestedProjectName),
    confidence,
    warnings: [...warnings],
  };

  return { extraction, classification };
}

function normalizeLineItem(raw: Record<string, unknown>): ExtractedLineItem {
  return {
    description: typeof raw.description === "string" ? raw.description.trim() : "",
    qty: typeof raw.qty === "string" && raw.qty.trim() ? raw.qty.trim() : "1",
    unitPrice: toNumber(raw.unitPrice),
    itemTotal: toNumber(raw.itemTotal) ?? 0,
  };
}

function normalizeItemClassification(raw: Record<string, unknown>): ItemClassification {
  return {
    primaryCategory: typeof raw.primaryCategory === "string" ? raw.primaryCategory.trim() : "",
    secondaryCategory: nonEmptyString(raw.secondaryCategory),
    tags: toStringArray(raw.tags),
    searchKeywords: toStringArray(raw.searchKeywords),
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
