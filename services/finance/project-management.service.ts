/**
 * Project delete-protection (Project Detail's "Delete project" DangerZone action) —
 * mirrors account-management.service.ts's deleteAccount exactly: block deletion rather
 * than cascade, since a project can carry real financial history (transactions) and
 * category budget lines that must never be silently discarded. Mark Inactive
 * (setProjectStatusAction, already built) is the sanctioned alternative in both cases —
 * this file introduces no new "archive" concept, just guards the one existing delete path.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as projectRepository from "@/repositories/project.repository";
import * as transactionHeaderRepository from "@/repositories/transaction-header.repository";
import * as projectBudgetRepository from "@/repositories/project-budget.repository";
import * as recurringRuleRepository from "@/repositories/recurring-rule.repository";

/** Thrown by deleteProject when the project has transaction history — callers show its
 *  message verbatim rather than a generic failure, so the user knows to Mark Inactive instead. */
export class ProjectHasTransactionsError extends Error {}

/** Thrown by deleteProject when the project still has category (LIFETIME) budget lines. */
export class ProjectHasBudgetsError extends Error {}

/** Thrown by deleteProject when an active recurring rule still references this project —
 *  distinct from ProjectHasTransactionsError because a brand-new rule (no occurrences
 *  generated yet) can hit this with zero transaction history to catch it otherwise. Mirrors
 *  account-management.service.ts's AccountHasRecurringRulesError exactly. */
export class ProjectHasRecurringRuleError extends Error {}

/** Blocks permanent deletion if the project has any transaction history, any category
 *  budget line, or an active recurring rule — all three checks are existence-only (no
 *  full-row fetch) since this only ever needs a yes/no answer. Mark Inactive is always the
 *  safe alternative in every case. */
export async function deleteProject(supabase: SupabaseClient, id: string): Promise<void> {
  const hasTransactions = await transactionHeaderRepository.existsForProjectId(supabase, id);
  if (hasTransactions) {
    throw new ProjectHasTransactionsError("This project has transactions and cannot be deleted. Mark it inactive instead.");
  }

  const hasBudgets = await projectBudgetRepository.existsLifetimeForProject(supabase, id);
  if (hasBudgets) {
    throw new ProjectHasBudgetsError("This project has category budgets and cannot be deleted. Remove them first, or mark the project inactive.");
  }

  const hasActiveRecurringRule = await recurringRuleRepository.existsActiveForProjectId(supabase, id);
  if (hasActiveRecurringRule) {
    throw new ProjectHasRecurringRuleError("This project is used by an active recurring rule and cannot be deleted. Mark it inactive instead, or deactivate the recurring rule first.");
  }

  await projectRepository.remove(supabase, id);
}
