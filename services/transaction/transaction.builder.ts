/**
 * Transaction Builder (TAD-004 §3 Transaction Services).
 * Assembles a verified ExtractionResult + ClassificationResult + resolved
 * account/project + SGD conversion + generated receipt id into the exact payload
 * shape services/transaction.service.ts sends to the save_transaction RPC
 * (migration 005). Pure, deterministic — no I/O, no AI, no persistence here.
 */
import type { ExtractionResult, ClassificationResult } from "@/types/ai";

export type BuiltTransactionPayload = {
  header: {
    receipt_id: string;
    transaction_date: string;
    merchant: string;
    transaction_type: string;
    primary_category: string;
    source_account_id: string | null;
    target_account_id: string | null;
    project_id: string | null;
    currency: string;
    original_amount: number;
    exchange_rate: number | null;
    sgd_total_amount: number;
    comments: string | null;
    status: string;
  };
  items: {
    item_description: string;
    tags: string[] | null;
    item_group: string | null;
    search_keywords: string[] | null;
    primary_category: string;
    secondary_category: string | null;
    qty: string;
    unit_price: number | null;
    item_total: number;
  }[];
};

export type BuildTransactionInput = {
  receiptId: string;
  extraction: ExtractionResult;
  classification: ClassificationResult;
  sourceAccountId: string | null;
  projectId: string | null;
  sgdAmount: number;
  exchangeRate: number | null;
};

export function buildTransactionPayload(input: BuildTransactionInput): BuiltTransactionPayload {
  const { receiptId, extraction, classification, sourceAccountId, projectId, sgdAmount, exchangeRate } = input;

  if (extraction.lineItems.length !== classification.items.length) {
    throw new Error(
      `Cannot build transaction: extraction has ${extraction.lineItems.length} line item(s) but classification has ${classification.items.length}.`
    );
  }

  return {
    header: {
      receipt_id: receiptId,
      transaction_date: extraction.transactionDate ?? todayIso(),
      merchant: extraction.merchant || "Unknown merchant",
      transaction_type: extraction.transactionType,
      primary_category: classification.headerPrimaryCategory,
      source_account_id: sourceAccountId,
      target_account_id: null,
      project_id: projectId,
      currency: extraction.currency,
      original_amount: extraction.totalAmount,
      exchange_rate: exchangeRate,
      sgd_total_amount: sgdAmount,
      comments: null,
      status: "Confirmed",
    },
    items: extraction.lineItems.map((item, i) => {
      const classified = classification.items[i];
      return {
        item_description: item.description,
        tags: classified.tags.length ? classified.tags : null,
        item_group: null,
        search_keywords: classified.searchKeywords.length ? classified.searchKeywords : null,
        primary_category: classified.primaryCategory,
        secondary_category: classified.secondaryCategory,
        qty: item.qty,
        unit_price: item.unitPrice,
        item_total: item.itemTotal,
      };
    }),
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
