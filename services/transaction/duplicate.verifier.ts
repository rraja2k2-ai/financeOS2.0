/**
 * Duplicate detection (TAD-004 §3 Transaction Services; TAD-003 §6 Rule 3).
 * Deterministic — same merchant (case-insensitive) + same date + amount within a small
 * tolerance. Never blocks a save (TAD-007 §6: warnings don't block unless data
 * integrity is compromised) — surfaces as a "possible duplicate" for Needs You / Review.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as transactionHeaderRepository from "@/repositories/transaction-header.repository";
import type { TransactionHeader } from "@/domain/transaction-header";

export type DuplicateCheck = {
  possibleDuplicates: TransactionHeader[];
  isDuplicate: boolean;
};

const AMOUNT_TOLERANCE = 0.05;

export async function checkForDuplicates(
  supabase: SupabaseClient,
  merchant: string,
  transactionDate: string,
  totalAmount: number,
  currency: string
): Promise<DuplicateCheck> {
  if (!merchant.trim() || !transactionDate) {
    return { possibleDuplicates: [], isDuplicate: false };
  }

  const candidates = await transactionHeaderRepository.findByMerchantAndDate(supabase, merchant, transactionDate);

  // Compare in the same currency (original_amount), not sgd_total_amount — comparing a
  // native-currency total against an SGD-converted one would be comparing different units.
  const possibleDuplicates = candidates.filter(
    (c) => c.currency === currency && Math.abs(Number(c.original_amount) - totalAmount) <= AMOUNT_TOLERANCE
  );

  return { possibleDuplicates, isDuplicate: possibleDuplicates.length > 0 };
}
