/**
 * Multi-Page Receipt Capture — post-extraction text normalization. Pure string
 * transforms only; never touches amounts, dates, receipt/invoice numbers, currency
 * codes, account names, or category names (those are typed/numeric fields elsewhere in
 * CaptureReceiptResult, untouched by this module).
 *
 * Normalization only fires on text that is entirely lowercase or entirely uppercase —
 * the ambiguous, raw-OCR-looking case. Text the AI already returned in mixed case is
 * left untouched, since that's the AI already having applied (or preserved) valid
 * brand styling ("iPhone", "McDonald's") — this module never second-guesses it.
 */

/** Merchant names whose correct styling can't be produced by generic title-casing
 *  (a mid-word capital, or a fused multi-word brand) — matched case-insensitively
 *  against the trimmed raw value before any generic transform runs. */
const MERCHANT_ALIASES: Record<string, string> = {
  "ntuc fairprice": "NTUC FairPrice",
  "sheng siong": "Sheng Siong",
  "cold storage": "Cold Storage",
  "mustafa centre": "Mustafa Centre",
  "mcdonald's": "McDonald's",
  "mcdonalds": "McDonald's",
  "7-eleven": "7-Eleven",
  "7 eleven": "7-Eleven",
};

/** Common abbreviations that must stay uppercase even inside an otherwise-lowercased
 *  or title-cased run — not master data (CLAUDE.md's account/category/project names
 *  come from the database), just well-known short forms a title-case pass would
 *  otherwise mangle (e.g. "Ntuc" or "Gst"). */
const KNOWN_ABBREVIATIONS = new Set(["NTUC", "GST", "ATM", "PDF", "USD", "SGD", "MRT", "LRT", "DBS", "OCBC", "UOB", "POSB", "HDB", "KFC", "BBQ"]);

function needsCaseNormalization(text: string): boolean {
  const letters = text.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 2) return false;
  return letters === letters.toLowerCase() || letters === letters.toUpperCase();
}

function titleCaseWord(word: string): string {
  if (!word || !/^[a-zA-Z]/.test(word)) return word; // leading digit/symbol → a code or unit ("500g"), left exactly as extracted
  const lettersOnly = word.replace(/[^a-zA-Z]/g, "");
  if (KNOWN_ABBREVIATIONS.has(lettersOnly.toUpperCase())) return word.toUpperCase();
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

/** Splits on whitespace/hyphens, title-cases each word, and rejoins with the original separators. */
function titleCase(text: string): string {
  return text
    .split(/([\s-]+)/)
    .map((token, i) => (i % 2 === 0 ? titleCaseWord(token) : token))
    .join("");
}

export function normalizeMerchantName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const alias = MERCHANT_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  return needsCaseNormalization(trimmed) ? titleCase(trimmed) : trimmed;
}

export function normalizeItemDescription(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return needsCaseNormalization(trimmed) ? titleCase(trimmed) : trimmed;
}
