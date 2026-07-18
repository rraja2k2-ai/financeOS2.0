/**
 * Tolerant JSON extraction from model output (TAD-005 §14 — "repair minor JSON
 * formatting issues"). We request responseMimeType application/json so output is
 * usually clean, but models occasionally wrap it in ```json fences or add stray
 * prose. This strips those and parses. It does NOT guess values — if it cannot
 * parse, it throws so the caller can retry or surface an error.
 */

export function parseModelJson<T = unknown>(text: string): T {
  const cleaned = stripFences(text).trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Fall back to the first balanced {...} or [...] block in the text.
    const block = extractFirstJsonBlock(cleaned);
    if (block) {
      return JSON.parse(block) as T;
    }
    throw new Error("[FinanceOS] Model did not return parseable JSON.");
  }
}

function stripFences(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fence ? fence[1] : text;
}

function extractFirstJsonBlock(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;

  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
