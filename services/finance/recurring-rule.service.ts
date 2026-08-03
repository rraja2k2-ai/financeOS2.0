/**
 * Recurring Rule CRUD (Recurring Transactions feature). A rule is a living template
 * (domain/recurring-rule.ts) — start_date is fixed at creation (the clamp anchor day for
 * month/year math); editing never touches start_date or next_due_date, only generation
 * (a separate, not-yet-built function) ever advances next_due_date. This file never
 * touches transaction_headers or account balances.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as recurringRuleRepository from "@/repositories/recurring-rule.repository";
import * as accountRepository from "@/repositories/account.repository";
import * as projectRepository from "@/repositories/project.repository";
import * as transactionHeaderRepository from "@/repositories/transaction-header.repository";
import type { RecurringRule, RecurringInterval, RecurringEndMode } from "@/domain/recurring-rule";
import { TRANSACTION_TYPES, type TransactionType } from "@/constants/transaction-types";
import { merchantRequiredFor, amountsCanBeNegativeFor, resolveMerchantForSave } from "@/services/capture/save-capture.service";
import * as transactionService from "@/services/transaction.service";
import { generateReceiptId } from "@/services/transaction/receiptid.service";
import { convertToBaseCurrency } from "@/services/finance/exchange.service";

export class InvalidRecurringRuleError extends Error {}
export class RecurringRuleNotFoundError extends Error {}

const RECURRING_TRANSACTION_TYPES: TransactionType[] = [
  TRANSACTION_TYPES.EXPENSE,
  TRANSACTION_TYPES.INCOME,
  TRANSACTION_TYPES.TRANSFER,
  TRANSACTION_TYPES.ADJUSTMENT,
];

/** The editable definition of a rule — everything except start_date/next_due_date
 *  (immutable after creation, see module comment) and is_active (its own action).
 *  Accounts/project are exact names, not ids — the same convention the Review Screen's
 *  own pickers already use; resolved to ids here (resolveNames below), exactly mirroring
 *  the name -> id lookup save-capture.service.ts already does for every normal
 *  transaction save. Used by the Edit form (RecurringRuleForm) — "Make Recurring" doesn't
 *  need this at all, see createRecurringRuleFromTransaction below, which already has ids
 *  straight from the source transaction and never needs a name-based picker. */
export type RecurringRuleFields = {
  transaction_type: string;
  merchant: string;
  amount: number;
  currency: string;
  primary_category: string;
  secondary_category: string | null;
  source_account_name: string | null;
  target_account_name: string | null;
  project_name: string | null;
  comments: string | null;
  interval_count: number;
  interval_unit: RecurringInterval;
  end_mode: RecurringEndMode;
  /** Read only when end_mode = 'ON_DATE'. */
  end_date?: string | null;
  /** Read only when end_mode = 'AFTER_COUNT' — converted to a concrete end_value once, here. */
  occurrence_count?: number | null;
};

/** The id-based shape every write actually persists — both createRecurringRule (after
 *  resolving names) and createRecurringRuleFromTransaction (already has ids) converge
 *  here, so validation/end-value logic exists in exactly one place. */
type RecurringRuleFieldsById = {
  transaction_type: string;
  merchant: string;
  amount: number;
  currency: string;
  primary_category: string;
  secondary_category: string | null;
  source_account_id: string | null;
  target_account_id: string | null;
  project_id: string | null;
  comments: string | null;
  interval_count: number;
  interval_unit: RecurringInterval;
  end_mode: RecurringEndMode;
  end_date?: string | null;
  occurrence_count?: number | null;
};

async function resolveNames(
  supabase: SupabaseClient,
  fields: RecurringRuleFields
): Promise<RecurringRuleFieldsById> {
  const [accounts, projects] = await Promise.all([accountRepository.list(supabase), projectRepository.list(supabase)]);
  return {
    ...fields,
    source_account_id: fields.source_account_name ? (accounts.find((a) => a.account_name === fields.source_account_name)?.id ?? null) : null,
    target_account_id: fields.target_account_name ? (accounts.find((a) => a.account_name === fields.target_account_name)?.id ?? null) : null,
    project_id: fields.project_name ? (projects.find((p) => p.project_name === fields.project_name)?.id ?? null) : null,
  };
}

/**
 * Advances one due date forward by one interval, anchored to `anchorDay` — always the
 * rule's own start_date, never `current`'s own (possibly already-clamped) day. This is
 * what prevents drift after a short month: Jan 31 -> Feb 28 -> Mar 31, never Mar 28,
 * because Mar is computed from start_date's day (31) again, not chained off Feb 28.
 * Exported so generation (a later step) reuses this exact function — one implementation
 * of the recurrence math, never duplicated.
 */
export function advanceDueDate(current: string, anchor: string, intervalCount: number, unit: RecurringInterval): string {
  const cur = parseDate(current);
  const anchorDate = parseDate(anchor);

  if (unit === "WEEK") {
    const next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + intervalCount * 7);
    return formatDate(next);
  }

  if (unit === "MONTH") {
    const totalMonths = cur.getFullYear() * 12 + cur.getMonth() + intervalCount;
    const year = Math.floor(totalMonths / 12);
    const month = totalMonths % 12;
    return formatDate(clampToMonth(year, month, anchorDate.getDate()));
  }

  // YEAR — month never changes, only the year, so the anchor's own month applies directly.
  return formatDate(clampToMonth(cur.getFullYear() + intervalCount, anchorDate.getMonth(), anchorDate.getDate()));
}

/** The date of the Nth occurrence (start_date itself counts as occurrence 1) — how
 *  "After N Occurrences" becomes a stored end_value, using the same stepping function
 *  real generation will use, so the two can never disagree. */
function nthOccurrenceDate(startDate: string, n: number, intervalCount: number, unit: RecurringInterval): string {
  let date = startDate;
  for (let i = 1; i < n; i++) {
    date = advanceDueDate(date, startDate, intervalCount, unit);
  }
  return date;
}

function clampToMonth(year: number, month: number, day: number): Date {
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDayOfMonth));
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function resolveEndValue(fields: RecurringRuleFieldsById, startDate: string): string | null {
  switch (fields.end_mode) {
    case "NEVER":
      return null;
    case "ON_DATE":
      if (!fields.end_date) throw new InvalidRecurringRuleError("An end date is required.");
      return fields.end_date;
    case "AFTER_COUNT":
      if (!fields.occurrence_count || fields.occurrence_count < 1) {
        throw new InvalidRecurringRuleError("Number of occurrences must be at least 1.");
      }
      return nthOccurrenceDate(startDate, fields.occurrence_count, fields.interval_count, fields.interval_unit);
  }
}

function validateAndNormalize(fields: RecurringRuleFieldsById): RecurringRuleFieldsById & { transaction_type: TransactionType } {
  if (!RECURRING_TRANSACTION_TYPES.includes(fields.transaction_type as TransactionType)) {
    throw new InvalidRecurringRuleError("Unsupported transaction type for a recurring rule.");
  }
  const transactionType = fields.transaction_type as TransactionType;

  if (!Number.isInteger(fields.interval_count) || fields.interval_count < 1) {
    throw new InvalidRecurringRuleError("Repeat interval must be a whole number of at least 1.");
  }
  if (fields.amount === 0) {
    throw new InvalidRecurringRuleError("Amount cannot be zero.");
  }
  if (fields.amount < 0 && !amountsCanBeNegativeFor(transactionType)) {
    throw new InvalidRecurringRuleError("Amount cannot be negative for this transaction type.");
  }

  const merchant = resolveMerchantForSave(transactionType, fields.merchant, fields.target_account_id);
  if (merchantRequiredFor(transactionType) && !merchant.trim()) {
    throw new InvalidRecurringRuleError("Merchant is required for this transaction type.");
  }

  return { ...fields, transaction_type: transactionType, merchant };
}

/** The one place a rule row is actually inserted — every creation path (name-based or
 *  from-transaction) converges here after resolving to ids, so validation/end-value
 *  logic exists exactly once. */
async function insertRule(supabase: SupabaseClient, fields: RecurringRuleFieldsById, startDate: string): Promise<RecurringRule> {
  const normalized = validateAndNormalize(fields);
  const endValue = resolveEndValue(normalized, startDate);

  return recurringRuleRepository.insert(supabase, {
    transaction_type: normalized.transaction_type,
    merchant: normalized.merchant,
    amount: normalized.amount.toFixed(2),
    currency: normalized.currency,
    primary_category: normalized.primary_category,
    secondary_category: normalized.secondary_category,
    source_account_id: normalized.source_account_id,
    target_account_id: normalized.target_account_id,
    project_id: normalized.project_id,
    comments: normalized.comments,
    interval_count: normalized.interval_count,
    interval_unit: normalized.interval_unit,
    start_date: startDate,
    next_due_date: startDate,
    end_mode: normalized.end_mode,
    end_value: endValue,
    is_active: true,
  });
}

/**
 * "Make Recurring" — creates a rule directly from an already-saved transaction. Merchant,
 * category, account(s), project, and comments are silently inherited (Decision: multi-item
 * transactions use the header's own primary_category and total, never itemized detail);
 * only the recurrence settings (frequency + end condition) are asked for. Already has real
 * ids from the header, so it never needs a name-based picker or resolveNames at all — the
 * smallest possible creation path.
 */
export async function createRecurringRuleFromTransaction(
  supabase: SupabaseClient,
  headerId: string,
  recurrence: {
    intervalCount: number;
    intervalUnit: RecurringInterval;
    endMode: RecurringEndMode;
    endDate: string | null;
    occurrenceCount: number | null;
  }
): Promise<RecurringRule> {
  const header = await transactionHeaderRepository.getById(supabase, headerId);
  if (!header) {
    throw new RecurringRuleNotFoundError("Transaction not found.");
  }

  const startDate = advanceDueDate(header.transaction_date, header.transaction_date, recurrence.intervalCount, recurrence.intervalUnit);

  return insertRule(
    supabase,
    {
      transaction_type: header.transaction_type,
      merchant: header.merchant,
      amount: Number(header.original_amount),
      currency: header.currency,
      primary_category: header.primary_category,
      secondary_category: null,
      source_account_id: header.source_account_id,
      target_account_id: header.target_account_id,
      project_id: header.project_id,
      comments: header.comments,
      interval_count: recurrence.intervalCount,
      interval_unit: recurrence.intervalUnit,
      end_mode: recurrence.endMode,
      end_date: recurrence.endDate,
      occurrence_count: recurrence.occurrenceCount,
    },
    startDate
  );
}

export async function updateRecurringRule(supabase: SupabaseClient, id: string, fields: RecurringRuleFields): Promise<RecurringRule> {
  const existing = await recurringRuleRepository.getById(supabase, id);
  if (!existing) {
    throw new RecurringRuleNotFoundError("Recurring rule not found.");
  }

  const resolved = await resolveNames(supabase, fields);
  const normalized = validateAndNormalize(resolved);
  const endValue = resolveEndValue(normalized, existing.start_date);

  return recurringRuleRepository.update(supabase, id, {
    transaction_type: normalized.transaction_type,
    merchant: normalized.merchant,
    amount: normalized.amount.toFixed(2),
    currency: normalized.currency,
    primary_category: normalized.primary_category,
    secondary_category: normalized.secondary_category,
    source_account_id: normalized.source_account_id,
    target_account_id: normalized.target_account_id,
    project_id: normalized.project_id,
    comments: normalized.comments,
    interval_count: normalized.interval_count,
    interval_unit: normalized.interval_unit,
    end_mode: normalized.end_mode,
    end_value: endValue,
  });
}

export async function setRecurringRuleActive(supabase: SupabaseClient, id: string, isActive: boolean): Promise<RecurringRule> {
  return recurringRuleRepository.update(supabase, id, { is_active: isActive });
}

export async function deleteRecurringRule(supabase: SupabaseClient, id: string): Promise<void> {
  await recurringRuleRepository.remove(supabase, id);
}

export async function listRecurringRules(supabase: SupabaseClient): Promise<RecurringRule[]> {
  return recurringRuleRepository.list(supabase);
}

export async function getRecurringRule(supabase: SupabaseClient, id: string): Promise<RecurringRule | null> {
  return recurringRuleRepository.getById(supabase, id);
}

// ---------------------------------------------------------------------------------------
// Generation — manual only (Decision: no cron, no background jobs). Generated
// transactions are ordinary rows created through transactionService.createTransaction(),
// which itself posts through the existing Account Posting Engine — nothing here bypasses
// that flow, and this is not a second posting engine. Editing a rule (above) never
// touches next_due_date; this is the ONLY code that ever advances it, immediately after
// each generated transaction, which is what makes running Generate repeatedly safe.
// ---------------------------------------------------------------------------------------

export type RuleGenerationResult = {
  ruleId: string;
  transactionIds: string[];
  /** Non-null if this rule's occurrence at next_due_date failed (validation, missing
   *  exchange rate, deleted account, DB error, posting failure) — generation for THIS
   *  rule stops immediately on the failed occurrence and never continues to later ones;
   *  next_due_date is left pointing at the failed occurrence so the next Generate run
   *  retries it first. Never silently swallowed — always surfaced to the caller. Other
   *  rules in the same run are unaffected and still get processed. */
  error: string | null;
};

/** Hard ceiling on occurrences generated for one rule in one run — an infinite-loop guard
 *  (e.g. if a future bug ever made advanceDueDate stop moving forward), not a performance
 *  tuning knob. A personal app's most extreme realistic case (a weekly rule untouched for
 *  years) lands nowhere near this. */
const MAX_OCCURRENCES_PER_RULE_PER_RUN = 1000;

/**
 * Generates every missing occurrence, for every active rule, due on or before `until` —
 * one manual action covering all rules at once (Decision 4). `until` is clamped to today
 * server-side regardless of what the caller passes, since "never generate future
 * transactions" must hold even if a caller's own date picker didn't enforce it.
 */
export async function generateDueTransactions(supabase: SupabaseClient, until: string): Promise<RuleGenerationResult[]> {
  const today = new Date().toISOString().slice(0, 10);
  const effectiveUntil = until > today ? today : until;

  const dueRules = await recurringRuleRepository.listDue(supabase, effectiveUntil);
  const results: RuleGenerationResult[] = [];

  for (const rule of dueRules) {
    results.push(await generateForRule(supabase, rule, effectiveUntil));
  }

  return results;
}

async function generateForRule(supabase: SupabaseClient, rule: RecurringRule, effectiveUntil: string): Promise<RuleGenerationResult> {
  const transactionIds: string[] = [];
  let cursor = rule.next_due_date;
  let iterations = 0;

  while (cursor <= effectiveUntil && (rule.end_value === null || cursor <= rule.end_value)) {
    if (++iterations > MAX_OCCURRENCES_PER_RULE_PER_RUN) {
      console.warn(`[recurring-rule] rule ${rule.id} hit the ${MAX_OCCURRENCES_PER_RULE_PER_RUN}-occurrence safety cap; stopping this run early.`);
      break;
    }

    try {
      // Resolved fresh for THIS occurrence's date — never cached from a prior occurrence
      // or from the rule itself, so a long-running rule's exchange rate never drifts.
      const { baseAmount, exchangeRate } = await convertToBaseCurrency(supabase, Number(rule.amount), rule.currency);

      const { header } = await transactionService.createTransaction(supabase, {
        header: {
          receipt_id: generateReceiptId(),
          transaction_date: cursor,
          merchant: rule.merchant,
          transaction_type: rule.transaction_type,
          primary_category: rule.primary_category,
          source_account_id: rule.source_account_id,
          target_account_id: rule.target_account_id,
          project_id: rule.project_id,
          currency: rule.currency,
          original_amount: Number(rule.amount),
          exchange_rate: exchangeRate,
          sgd_total_amount: baseAmount,
          comments: rule.comments,
          status: "Confirmed",
        },
        items: [
          {
            item_description: rule.merchant || rule.primary_category,
            tags: null,
            item_group: null,
            search_keywords: null,
            primary_category: rule.primary_category,
            secondary_category: rule.secondary_category,
            qty: "1",
            unit: null,
            pack_size: null,
            unit_price: null,
            item_total: Number(rule.amount),
          },
        ],
      });

      transactionIds.push(header.id);

      // Advance and persist immediately after this one occurrence — not batched — so an
      // interrupted run leaves next_due_date at a consistent, correct checkpoint rather
      // than re-attempting from a stale one.
      cursor = advanceDueDate(cursor, rule.start_date, rule.interval_count, rule.interval_unit);
      await recurringRuleRepository.update(supabase, rule.id, { next_due_date: cursor });
    } catch (err) {
      // Stop THIS rule immediately — next_due_date was last written at the end of the
      // prior successful iteration, so it's already left pointing at this failed
      // occurrence. Never continue to later occurrences of the same rule past a failure.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[recurring-rule] rule ${rule.id} failed generating the occurrence due ${cursor}: ${message}`);
      return { ruleId: rule.id, transactionIds, error: message };
    }
  }

  return { ruleId: rule.id, transactionIds, error: null };
}
