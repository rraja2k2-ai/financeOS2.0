import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransactionHeader } from "@/domain/transaction-header";
import type { TransactionItem } from "@/domain/transaction-item";
import * as transactionHeaderRepository from "@/repositories/transaction-header.repository";
import * as transactionItemRepository from "@/repositories/transaction-item.repository";

export type Transaction = {
  header: TransactionHeader;
  items: TransactionItem[];
};

export type CreateTransactionInput = {
  header: Omit<TransactionHeader, "id" | "created_at" | "updated_at">;
  items: Omit<TransactionItem, "id" | "created_at" | "updated_at" | "header_id">[];
};

export type UpdateTransactionInput = {
  header: Partial<Omit<TransactionHeader, "id" | "created_at" | "updated_at">>;
  items?: (Partial<Omit<TransactionItem, "id" | "created_at" | "updated_at" | "header_id">> & { id: string })[];
};

export async function createTransaction(supabase: SupabaseClient, input: CreateTransactionInput): Promise<Transaction> {
  // TODO: Replace with Supabase RPC atomic transaction.

  const { data: header, error: headerError } = await supabase
    .from("transaction_headers")
    .insert(input.header)
    .select()
    .single();

  if (headerError) {
    throw headerError;
  }

  const itemsWithHeaderId = input.items.map((item) => ({
    ...item,
    header_id: header.id,
  }));

  const { data: items, error: itemsError } = await supabase
    .from("transaction_items")
    .insert(itemsWithHeaderId)
    .select();

  if (itemsError) {
    throw itemsError;
  }

  return {
    header,
    items: items || [],
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
