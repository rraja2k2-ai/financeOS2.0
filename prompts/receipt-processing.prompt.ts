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
    "- Dates must be ISO format (YYYY-MM-DD) in the OUTPUT. The receipt's own printed date is usually numeric and ambiguous (e.g. \"21/07/26\", \"03/04/2026\") — read it carefully, segment by segment, before converting:",
    "  1. If the receipt spells the month out (e.g. \"21 Jul 2026\", \"Jul 21, 2026\"), there is no ambiguity — use that reading directly.",
    "  2. Otherwise, for a numeric date with three segments, DEFAULT TO DAY-FIRST (DD/MM/YY or DD/MM/YYYY) — this app's receipts are predominantly Singapore/India-style, day before month. Do not default to US month-first (MM/DD/YY) reading.",
    "  3. Whenever a segment's value is not a valid month (over 12), that segment MUST be the day, regardless of its position — e.g. \"21/07/26\" has 21 in the first position, which cannot be a month, so it must be the day: day=21, month=07, giving 2026-07-21. Never 2026-07-26 — the last segment (26) is the YEAR, not a second reading of the day.",
    "  4. A 2-digit year is always the YEAR, never the day, regardless of position — e.g. the trailing \"26\" in \"21/07/26\" is the year 2026, not day 26. Expand a 2-digit year to the 2000s.",
    "  5. If genuinely ambiguous after the above (e.g. \"03/04/26\", where both 3 and 4 could be day or month), keep the day-first default from rule 2.",
    "  Amounts must be plain numbers without currency symbols.",
    "- Item prices must match what is printed on the receipt. Set header.tax only when tax is charged separately on top of item prices (if item prices already sum to the total, tax is null).",
    "- Categorize every item using ONLY the primary/secondary category pairs listed in CATEGORIES. Use exact names. If nothing fits, use primary \"Miscellaneous\".",
    "- CATEGORIZATION RULES map merchant text to categories: if the merchant matches a rule's pattern (case-insensitive substring), prefer that rule's categories, and its account hint for headerSuggestions.account.",
    "- headerSuggestions.account must be an exact name from ACCOUNTS, or null. headerSuggestions.project must be an exact name from PROJECTS only when the user context or receipt clearly indicates one, else null.",
    "- Determine headerSuggestions.account using this priority order, stopping at the first that applies. If evidence conflicts, or more than one Account Mapping Rule appears to match, resolve using this same order — never guess:",
    "  1. Explicit user context: if the user context names an account (e.g. \"POSB Bank\", \"POSB Credit Card\", \"HSBC Credit Card\", \"SC Credit Card\", \"Mari Credit Card\", \"Citi Credit Card\", \"Cash\", or any other exact/clear match to a name in ACCOUNTS), use that account. Natural language is enough — the user never writes \"Payment Method: X\".",
    "  2. Account Mapping Rules: if a rule's keyword appears anywhere in the extracted receipt text or the user context — ignoring surrounding characters, so keyword \"2148\" matches \"2148\", \"****2148\", \"XXXX2148\", \"Card 2148\", \"Ending 2148\" (one configured keyword covers every such variation) — use that rule's account. These rules are guidance only, not a fixed lookup table; you still make the final call.",
    "  3. Receipt reasoning: if no rule matches, use the receipt contents together with ACCOUNTS to determine the most likely source account.",
    "  4. Uncertain: if the account still cannot be determined confidently after the above, return null. Do not guess.",
    "- The user context is authoritative: when it conflicts with the receipt (e.g. payment method, project), trust the user context.",
    "- If there are no pages, extract what you can from the user context alone.",
    "- This request always produces exactly ONE transaction, no matter how many sentences the user context has. Read the WHOLE user context first and judge overall intent before extracting anything — do not process it sentence-by-sentence.",
    "- CONSOLIDATE related sentences into that one transaction. User context is often several short lines describing the SAME errand, trip, or purchase from different angles (e.g. a multi-leg trip, a morning and an evening run, a starting point and an ending point) — these are facets of ONE expense, not separate ones. Pick ONE concise, natural merchant/description that summarizes the whole context (e.g. \"Ashwanth School Transport\", \"Office Travel\"), never a literal concatenation or restatement of each input sentence.",
    "- Only create more than one entry in `items` when the context or receipt describes genuinely distinct purchased things or services, each with its own identifiable amount (e.g. a receipt's separate line items, or the user context naming two different amounts for two different things). Several sentences describing legs, stops, or details of the SAME trip or errand are normally ONE item, not one item per sentence. When there are no pages and no amounts are stated, still produce exactly one item summarizing the context (qty 1, amounts null) so the transaction has something to save — never fabricate a separate item just because the context has multiple lines.",
    "- If the user context clearly names a second, separate purchase that does not belong with the main transaction (a different merchant/thing bought, its own amount, and its own payment method or account, distinct from the receipt or the rest of the context) — do NOT merge it into the main transaction's items or total, and do not let it change header.total. Summarize it briefly in header.notes instead (e.g. \"Also mentioned: fruits, SGD 10, paid by Cash — not included in this transaction, capture separately.\") so the user notices it; only ONE header is ever returned by this request.",
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
    "ACCOUNT MAPPING RULES (keyword -> account; see priority order above):",
    JSON.stringify(masterData.accountMappingRules),
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
