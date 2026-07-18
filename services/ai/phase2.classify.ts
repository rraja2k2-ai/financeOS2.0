/**
 * Phase 2 — Classification service (TAD-005 §5c).
 *
 * Enriches a verified ExtractionResult with categories, tags, search keywords, and
 * suggested account/project names. Never returns UUIDs — the server resolves suggested
 * names to real records later (account.matcher / project.matcher, not built yet).
 */
import type { AIProvider } from "./provider";
import { loadPrompt } from "./prompt.loader";
import { parseModelJson } from "./json";
import { validateClassification } from "./response.validator";
import type { ClassificationContext } from "./context.builder";
import type { ClassificationResult, ExtractionResult, ItemClassification } from "@/types/ai";

export async function classify(
  provider: AIProvider,
  extraction: ExtractionResult,
  context: ClassificationContext
): Promise<ClassificationResult> {
  const { system, user } = loadPrompt("phase2/classify.md", {
    CATEGORY_LIST: formatCategoryList(context.categories),
    ACCOUNT_LIST: context.accountNames.length ? context.accountNames.join("\n") : "(none)",
    PROJECT_LIST: context.projectNames.length ? context.projectNames.join("\n") : "(none)",
    EXTRACTION_JSON: JSON.stringify(extractionForPrompt(extraction), null, 2),
  });

  const response = await provider.generateJson({
    system,
    prompt: user,
    temperature: 0,
  });

  const parsed = parseModelJson<Record<string, unknown>>(response.text);
  const normalized = normalizeClassification(parsed, extraction.lineItems.length);

  return validateClassification(normalized);
}

/** Strip fields Phase 2 has no business seeing again (keeps the prompt focused). */
function extractionForPrompt(extraction: ExtractionResult) {
  return {
    merchant: extraction.merchant,
    currency: extraction.currency,
    totalAmount: extraction.totalAmount,
    transactionType: extraction.transactionType,
    paymentHint: extraction.paymentHint,
    projectHint: extraction.projectHint,
    lineItems: extraction.lineItems,
  };
}

function formatCategoryList(categories: ClassificationContext["categories"]): string {
  return categories.map((c) => `- ${c.primary}: ${c.subcategories.join(", ")}`).join("\n");
}

function normalizeClassification(raw: Record<string, unknown>, expectedItemCount: number): ClassificationResult {
  const warnings = toStringArray(raw.warnings);

  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  if (rawItems.length !== expectedItemCount) {
    warnings.push(
      `Classification returned ${rawItems.length} item(s) but extraction had ${expectedItemCount}.`
    );
  }

  const items: ItemClassification[] = rawItems.map((it) => normalizeItem(it as Record<string, unknown>));

  return {
    headerPrimaryCategory: typeof raw.headerPrimaryCategory === "string" ? raw.headerPrimaryCategory.trim() : "",
    items,
    suggestedAccountName: nonEmptyString(raw.suggestedAccountName),
    suggestedProjectName: nonEmptyString(raw.suggestedProjectName),
    confidence: clampConfidence(raw.confidence),
    warnings,
  };
}

function normalizeItem(raw: Record<string, unknown>): ItemClassification {
  return {
    primaryCategory: typeof raw.primaryCategory === "string" ? raw.primaryCategory.trim() : "",
    secondaryCategory: nonEmptyString(raw.secondaryCategory),
    tags: toStringArray(raw.tags),
    searchKeywords: toStringArray(raw.searchKeywords),
  };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0.5;
  return Math.min(1, Math.max(0, n));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}
