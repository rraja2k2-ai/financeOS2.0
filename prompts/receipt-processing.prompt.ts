/**
 * Receipt-processing prompt for the premium Capture flow (C2).
 *
 * This is the ONLY place in the codebase that builds the capture AI prompt. It is
 * provider-agnostic: it emits plain text (system instructions + task text) that any
 * CaptureAiProvider implementation assembles into its own request format, with the
 * receipt pages attached as multimodal parts by the provider. No provider SDK types
 * may appear here.
 */
import type { CaptureMasterData } from "@/services/ai/ai-provider";

export type ReceiptProcessingPrompt = {
  /** System instruction — role, rules, strict-JSON output contract. */
  system: string;
  /** Task text — FinanceOS master data + user context + page manifest. */
  task: string;
};

const OUTPUT_SCHEMA = `{
  "header": {
    "merchant": string | null,
    "transactionDate": string | null,   // ISO date "YYYY-MM-DD"
    "currency": string | null,          // 3-letter code, e.g. "SGD"
    "paymentMethod": string | null,     // as printed or from user context, e.g. "POSB debit card"
    "total": number | null,             // grand total actually paid
    "tax": number | null,               // only if tax is charged separately on top of item prices
    "discount": number | null,          // total discount amount, positive number
    "notes": string | null
  },
  "items": [
    {
      "description": string,
      "qty": number | null,
      "unit": string | null,            // e.g. "kg", "pc", "pack"
      "unitPrice": number | null,
      "lineAmount": number | null,
      "primaryCategory": string | null,
      "secondaryCategory": string | null
    }
  ],
  "headerSuggestions": {
    "account": string | null,           // exact account name from ACCOUNTS, or null
    "project": string | null            // exact project name from PROJECTS, or null
  },
  "other": {
    "tags": string[],                   // 0-5 short lowercase tags
    "confidence": number,               // 0.0-1.0 overall extraction confidence
    "summary": string                   // one short sentence describing the purchase
  }
}`;

export function buildReceiptProcessingPrompt(
  masterData: CaptureMasterData,
  userContext: string,
  pageCount: number
): ReceiptProcessingPrompt {
  const system = [
    "You are the receipt-processing engine of FinanceOS, a personal finance app.",
    "You receive the pages of ONE receipt (images or a PDF) plus optional user context, and you perform OCR, understanding, extraction, and categorization in this single request.",
    "",
    "Rules:",
    "- All attached pages belong to the SAME single receipt. Produce exactly ONE combined result.",
    "- Respond with STRICT JSON only — no markdown, no code fences, no explanations, no extra text.",
    "- Follow the output schema exactly. Use null for anything not present or not inferable. Never invent values.",
    "- Dates must be ISO format (YYYY-MM-DD). Amounts must be plain numbers without currency symbols.",
    "- Item prices must match what is printed on the receipt. Set header.tax only when tax is charged separately on top of item prices (if item prices already sum to the total, tax is null).",
    "- Categorize every item using ONLY the primary/secondary category pairs listed in CATEGORIES. Use exact names. If nothing fits, use primary \"Miscellaneous\".",
    "- CATEGORIZATION RULES map merchant text to categories: if the merchant matches a rule's pattern (case-insensitive substring), prefer that rule's categories, and its account hint for headerSuggestions.account.",
    "- headerSuggestions.account must be an exact name from ACCOUNTS (picked from payment hints on the receipt or in the user context), or null. headerSuggestions.project must be an exact name from PROJECTS only when the user context or receipt clearly indicates one, else null.",
    "- The user context is authoritative: when it conflicts with the receipt (e.g. payment method, project), trust the user context.",
    "- If there are no pages, extract what you can from the user context alone.",
  ].join("\n");

  const task = [
    "FINANCEOS MASTER DATA",
    "",
    `BASE CURRENCY: ${masterData.baseCurrency}`,
    "",
    "CATEGORIES (primary → subcategories, with type):",
    JSON.stringify(masterData.categories),
    "",
    "ACCOUNTS (active):",
    JSON.stringify(masterData.accounts),
    "",
    "PROJECTS (active):",
    JSON.stringify(masterData.projects),
    "",
    "CATEGORIZATION RULES:",
    JSON.stringify(masterData.categorizationRules),
    "",
    "USER CONTEXT (may be empty):",
    userContext.trim() || "(none)",
    "",
    `RECEIPT: ${pageCount > 0 ? `${pageCount} page(s) attached to this request.` : "no pages attached — use the user context only."}`,
    "",
    "OUTPUT SCHEMA (respond with exactly this JSON shape):",
    OUTPUT_SCHEMA,
  ].join("\n");

  return { system, task };
}
