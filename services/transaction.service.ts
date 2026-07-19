import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransactionHeader } from "@/domain/transaction-header";
import type { TransactionItem } from "@/domain/transaction-item";
import * as transactionHeaderRepository from "@/repositories/transaction-header.repository";
import * as transactionItemRepository from "@/repositories/transaction-item.repository";

export type Transaction = {
  header: TransactionHeader;
  items: TransactionItem[];
};

/** Insert shape for the atomic save RPC — numeric fields are `number` here (what you INSERT), not the `string` TransactionHeader/TransactionItem use for what Postgres RETURNS on select. */
export type CreateTransactionInput = {
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

export type UpdateTransactionInput = {
  header: Partial<Omit<TransactionHeader, "id" | "created_at" | "updated_at">>;
  items?: (Partial<Omit<TransactionItem, "id" | "created_at" | "updated_at" | "header_id">> & { id: string })[];
};

export type ReceiptAttachmentPayload = {
  original_file_url: string;
  thumbnail_url: string;
  ocr_raw_text: string;
  ai_extraction_json: unknown;
  file_size_bytes: number;
  mime_type: string | null;
};

/**
 * Atomic save via the save_transaction RPC (migration 005 / TAD-003 §9): header +
 * items + optional receipt_attachment commit or roll back together. Replaces the old
 * two-step insert (header could succeed while items failed, corrupting the record).
 */
export async function createTransaction(
  supabase: SupabaseClient,
  input: CreateTransactionInput,
  attachment?: ReceiptAttachmentPayload
): Promise<Transaction> {
  const { data, error } = await supabase.rpc("save_transaction", {
    header: input.header,
    items: input.items,
    attachment: attachment ?? null,
  });

  if (error) {
    throw error;
  }

  return {
    header: data.header,
    items: data.items || [],
  };
}

export async function getTransaction(supabase: SupabaseClient, id: string): Promise<Transaction | null> {
  const header = await transactionHeaderRepository.getById(supabase, id);

  if (!header) {
    return null;
  }

  const items = await transactionItemRepository.listByHeaderId(supabase, id);

  return {
    header,
    items,
  };
}

export async function updateTransaction(supabase: SupabaseClient, id: string, input: UpdateTransactionInput): Promise<Transaction> {
  const existingTransaction = await getTransaction(supabase, id);

  if (!existingTransaction) {
    throw new Error(`Transaction with id ${id} not found`);
  }

  if (input.header) {
    await transactionHeaderRepository.update(supabase, id, input.header);
  }

  let updatedItems = existingTransaction.items;

  if (input.items) {
    for (const itemUpdate of input.items) {
      const { id: itemId, ...itemData } = itemUpdate;
      await transactionItemRepository.update(supabase, itemId, itemData);
    }
  }

  const updatedTransaction = await getTransaction(supabase, id);

  if (!updatedTransaction) {
    throw new Error(`Transaction with id ${id} not found after update`);
  }

  return updatedTransaction;
}

export async function deleteTransaction(supabase: SupabaseClient, id: string): Promise<void> {
  const existingTransaction = await getTransaction(supabase, id);

  if (!existingTransaction) {
    throw new Error(`Transaction with id ${id} not found`);
  }

  for (const item of existingTransaction.items) {
    await transactionItemRepository.remove(supabase, item.id);
  }

  await transactionHeaderRepository.remove(supabase, id);
}
