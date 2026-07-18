/**
 * Validates AI output against the contract in TAD-005 §15: no UUIDs, no database
 * identifiers, categories must be real. The AI is a suggestion source — this is the
 * deterministic server-side gate before anything from a classification result is
 * trusted. Violations are recorded as warnings (TAD-005 §14: "return warnings instead
 * of silently guessing") rather than thrown, except UUID leakage, which is a hard
 * contract violation (TAD-005 §15: "No UUID generation... No database identifiers")
 * and always throws — the AI must never be in a position to smuggle an identifier in.
 */
import { isKnownCategory } from "@/constants/categories";
import type { ClassificationResult } from "@/types/ai";

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

export class AiContractViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiContractViolation";
  }
}

/** Throws if the classification result contains anything that looks like a UUID anywhere. */
export function assertNoIdentifiers(result: ClassificationResult): void {
  const haystack = JSON.stringify(result);
  if (UUID_RE.test(haystack)) {
    throw new AiContractViolation(
      "Classification result contains a UUID-shaped value — the AI must never return identifiers."
    );
  }
}

/**
 * Checks every category against the known taxonomy. Does not throw — unknown
 * categories are downgraded to a warning and the item is left for user correction
 * during review, per TAD-005 §14 (graceful degradation, not hard failure).
 */
export function validateCategories(result: ClassificationResult): ClassificationResult {
  const warnings = [...result.warnings];

  if (!isKnownCategory(result.headerPrimaryCategory)) {
    warnings.push(`Header category "${result.headerPrimaryCategory}" is not a recognized category.`);
  }

  result.items.forEach((item, i) => {
    if (!isKnownCategory(item.primaryCategory, item.secondaryCategory ?? undefined)) {
      warnings.push(
        `Item ${i + 1}: "${item.primaryCategory}" / "${item.secondaryCategory ?? "—"}" is not a recognized category pair.`
      );
    }
  });

  return { ...result, warnings };
}

/** Full server-side gate: identifier check (throws) then category validation (warns). */
export function validateClassification(result: ClassificationResult): ClassificationResult {
  assertNoIdentifiers(result);
  return validateCategories(result);
}
