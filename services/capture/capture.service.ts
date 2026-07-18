/**
 * Capture orchestration service (C2).
 *
 * The one entry point behind Capture & Process:
 *   input (pages + user context + preloaded master data)
 *     → getCaptureAiProvider()          (factory — the only place a provider is chosen)
 *     → provider.processReceipt()       (ONE multimodal request → parsed JSON)
 *     → normalizeReceiptResult()        (provider-independent shape validation)
 *
 * No Supabase access here — master data arrives preloaded via
 * services/capture/master-data.service.ts. No persistence in C2.
 */
import { getCaptureAiProvider } from "@/services/ai/providers";
import { CaptureAiError, type CaptureProcessingInput, type CaptureReceiptResult } from "@/services/ai/ai-provider";

export async function processCapture(input: CaptureProcessingInput): Promise<CaptureReceiptResult> {
  const provider = getCaptureAiProvider();
  const raw = await provider.processReceipt(input);
  return normalizeReceiptResult(raw);
}

/**
 * Validates/normalizes the model's parsed JSON into the CaptureReceiptResult contract.
 * Lenient on purpose: coerces types field-by-field and fills nulls, but throws
 * invalid_response when the payload is fundamentally not the expected shape.
 */
function normalizeReceiptResult(raw: unknown): CaptureReceiptResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new CaptureAiError("invalid_response", "AI response is not a JSON object.");
  }
  const root = raw as Record<string, unknown>;
  const header = asObject(root.header);
  const itemsRaw = Array.isArray(root.items) ? root.items : null;
  if (!header || !itemsRaw) {
    throw new CaptureAiError("invalid_response", "AI response is missing the header/items structure.");
  }
  const suggestions = asObject(root.headerSuggestions) ?? {};
  const other = asObject(root.other) ?? {};

  return {
    header: {
      merchant: asString(header.merchant),
      transactionDate: asString(header.transactionDate),
      currency: asString(header.currency),
      paymentMethod: asString(header.paymentMethod),
      total: asNumber(header.total),
      tax: asNumber(header.tax),
      discount: asNumber(header.discount),
      notes: asString(header.notes),
    },
    items: itemsRaw
      .map((entry) => asObject(entry))
      .filter((item): item is Record<string, unknown> => item !== null)
      .map((item) => ({
        description: asString(item.description) ?? "(unreadable item)",
        qty: asNumber(item.qty),
        unit: asString(item.unit),
        unitPrice: asNumber(item.unitPrice),
        lineAmount: asNumber(item.lineAmount),
        primaryCategory: asString(item.primaryCategory),
        secondaryCategory: asString(item.secondaryCategory),
      })),
    headerSuggestions: {
      account: asString(suggestions.account),
      project: asString(suggestions.project),
    },
    other: {
      tags: Array.isArray(other.tags) ? other.tags.filter((t): t is string => typeof t === "string") : [],
      confidence: asNumber(other.confidence),
      summary: asString(other.summary),
    },
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value;
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
}
