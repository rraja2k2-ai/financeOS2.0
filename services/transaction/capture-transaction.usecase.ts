/**
 * CaptureTransaction use case (TAD-008 §19; TAD-004 §7 Orchestrator Pattern).
 * Capture -> Extract+Classify -> Verify totals -> Match account/project ->
 * Convert to SGD -> Check duplicates -> Build -> Save. Each step calls exactly one
 * service; this orchestrates the sequence and decides whether the result needs
 * review (TAD-007 §6 Review Queue / Tier 1 "Needs You"), per the product decision
 * that there is NO mandatory review gate — only exceptions surface.
 *
 * Uses extract-and-classify.ts (ONE Gemini call) rather than phase1.extract.ts +
 * phase2.classify.ts (two calls) — see prompts/combined/extract-and-classify.md for
 * why: Gemini's free tier caps at 20 requests/day, and this app needs ~20
 * transactions/day, so two calls per transaction wouldn't fit.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIProvider, AiMediaPart } from "@/services/ai/provider";
import { extractAndClassify } from "@/services/ai/extract-and-classify";
import { buildClassificationContext } from "@/services/ai/context.builder";
import { verifyTotal, type TotalVerification } from "./total.verifier";
import { checkForDuplicates, type DuplicateCheck } from "./duplicate.verifier";
import { generateReceiptId } from "./receiptid.service";
import { buildTransactionPayload, type BuiltTransactionPayload } from "./transaction.builder";
import { matchAccount, type AccountMatchResult } from "@/services/finance/account.matcher";
import { matchProject, type ProjectMatchResult } from "@/services/finance/project.matcher";
import { convertToBaseCurrency } from "@/services/finance/exchange.service";
import { accountRepository, projectRepository } from "@/repositories";
import * as transactionService from "@/services/transaction.service";
import type { CaptureHints, ExtractionResult, ClassificationResult } from "@/types/ai";
import type { Transaction, ReceiptAttachmentPayload } from "@/services/transaction.service";

export type CaptureTransactionInput = {
  media?: AiMediaPart[];
  hints?: CaptureHints;
  attachment?: ReceiptAttachmentPayload;
};

export type CaptureTransactionResult = {
  extraction: ExtractionResult;
  classification: ClassificationResult;
  accountMatch: AccountMatchResult;
  projectMatch: ProjectMatchResult;
  totalCheck: TotalVerification;
  duplicateCheck: DuplicateCheck;
  payload: BuiltTransactionPayload;
  /** All warnings collected across every step, for the Review Queue. */
  warnings: string[];
  /** True if this should surface in Tier 1 "Needs You" instead of silently auto-saving. */
  needsReview: boolean;
  /** Present only when persisted (dryRun: false) AND the save succeeded. */
  saved: Transaction | null;
  /** Set when dryRun: false but the save itself failed — extraction/classification still succeeded, so this is returned rather than thrown (graceful degradation, TAD-005 §14). */
  saveError: string | null;
};

export type CaptureTransactionOptions = {
  /** When true (default), does everything except the final database write. */
  dryRun?: boolean;
};

const CONFIDENCE_THRESHOLD = 0.75;

export async function captureTransaction(
  supabase: SupabaseClient,
  provider: AIProvider,
  input: CaptureTransactionInput,
  options: CaptureTransactionOptions = {}
): Promise<CaptureTransactionResult> {
  const dryRun = options.dryRun ?? true;

  const [context, accounts, projects] = await Promise.all([
    buildClassificationContext(supabase),
    accountRepository.list(supabase),
    projectRepository.list(supabase),
  ]);

  const { extraction, classification, ocrText } = await extractAndClassify(
    provider,
    { media: input.media, hints: input.hints },
    context
  );
  const totalCheck = verifyTotal(extraction);

  const activeAccounts = accounts.filter((a) => a.status === "Active");
  const activeProjects = projects.filter((p) => p.status === "Active");

  const accountMatch = matchAccount(
    classification.suggestedAccountName ?? extraction.paymentHint,
    activeAccounts
  );
  const projectMatch = matchProject(classification.suggestedProjectName ?? extraction.projectHint, activeProjects);

  const sgdConversion = await convertToBaseCurrency(supabase, extraction.totalAmount, extraction.currency);

  const transactionDate = extraction.transactionDate ?? new Date().toISOString().slice(0, 10);
  const duplicateCheck = await checkForDuplicates(
    supabase,
    extraction.merchant,
    transactionDate,
    extraction.totalAmount,
    extraction.currency
  );

  const receiptId = generateReceiptId();

  const payload = buildTransactionPayload({
    receiptId,
    extraction,
    classification,
    sourceAccountId: accountMatch.account?.id ?? null,
    projectId: projectMatch.project?.id ?? null,
    sgdAmount: sgdConversion.baseAmount,
    exchangeRate: sgdConversion.exchangeRate,
  });

  const warnings = [
    ...extraction.warnings,
    ...classification.warnings,
    ...(totalCheck.matches ? [] : [`Item totals (${totalCheck.itemsSum}) don't match receipt total (${totalCheck.totalAmount}).`]),
    ...(accountMatch.note ? [accountMatch.note] : []),
    ...(projectMatch.note ? [projectMatch.note] : []),
    ...(duplicateCheck.isDuplicate ? [`Possible duplicate: ${duplicateCheck.possibleDuplicates.length} similar transaction(s) already exist for this merchant/date/amount.`] : []),
  ];

  const needsReview =
    !totalCheck.matches ||
    duplicateCheck.isDuplicate ||
    accountMatch.note !== null ||
    extraction.confidence < CONFIDENCE_THRESHOLD ||
    classification.confidence < CONFIDENCE_THRESHOLD;

  // ocrText from this run is authoritative — overrides any caller-supplied ocr_raw_text.
  const attachment: ReceiptAttachmentPayload | undefined = input.attachment
    ? { ...input.attachment, ocr_raw_text: ocrText || input.attachment.ocr_raw_text }
    : undefined;

  let saved: Transaction | null = null;
  let saveError: string | null = null;
  if (!dryRun) {
    try {
      saved = await transactionService.createTransaction(supabase, payload, attachment);
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
      warnings.push(`Could not save: ${saveError}`);
    }
  }

  return {
    extraction,
    classification,
    accountMatch,
    projectMatch,
    totalCheck,
    duplicateCheck,
    payload,
    warnings,
    needsReview: needsReview || saveError !== null,
    saved,
    saveError,
  };
}
