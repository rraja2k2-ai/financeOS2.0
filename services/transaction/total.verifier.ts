/**
 * Total verification (TAD-004 §3 Transaction Services; TAD-003 §6 Rule 3).
 * Deterministic — recomputes the sum server-side rather than trusting the AI's own
 * arithmetic. Phase 1 extraction already runs this same check internally so its
 * warnings are useful immediately; this is the independent, final gate right before
 * persistence, after account/project resolution may have touched nothing else about
 * the amounts (verification only reads, never adjusts, the numbers).
 */
import type { ExtractionResult } from "@/types/ai";

export type TotalVerification = {
  itemsSum: number;
  totalAmount: number;
  /** Cents-level tolerance for floating point drift, not a "close enough" fudge. */
  matches: boolean;
  difference: number;
};

const TOLERANCE = 0.02;

export function verifyTotal(extraction: ExtractionResult): TotalVerification {
  const itemsSum = round2(extraction.lineItems.reduce((sum, item) => sum + item.itemTotal, 0));
  const totalAmount = round2(extraction.totalAmount);
  const difference = round2(itemsSum - totalAmount);

  return {
    itemsSum,
    totalAmount,
    matches: Math.abs(difference) <= TOLERANCE,
    difference,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
