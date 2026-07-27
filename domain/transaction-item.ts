export type TransactionItem = {
  id: string;
  header_id: string | null;
  receipt_id: string | null;
  item_description: string;
  tags: string[] | null;
  item_group: string | null;
  search_keywords: string[] | null;
  primary_category: string;
  secondary_category: string;
  qty: string;
  /** Unit of measure (kg, g, L, ml, pcs, pack, ...) — Receipt Intelligence Foundation.
   *  Separate from `qty`'s existing free-text value+unit string; always null until a
   *  future milestone populates it (no AI extraction or inference yet). */
  unit: string | null;
  /** Package description as printed on the receipt (e.g. "5 kg", "6 cans") — Receipt
   *  Intelligence Foundation. Always null until a future milestone populates it. */
  pack_size: string | null;
  unit_price: string | null;
  item_total: string;
  created_at: string;
  updated_at: string;
};
