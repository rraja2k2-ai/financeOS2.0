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
  /** Unit of measure (kg, g, L, ml, pc, pack, ...) — Receipt Intelligence Foundation.
   *  Separate from `qty`'s existing free-text value+unit string. Populated by the AI
   *  capture pipeline (prompts/receipt-processing.prompt.ts's item schema) when the
   *  receipt states it directly — null when it doesn't, never inferred. Not every
   *  historical row has this populated (pre-dates the pipeline change), so a null here is
   *  expected and must be handled gracefully, not treated as a data error. */
  unit: string | null;
  /** Package description as printed on the receipt (e.g. "5 kg", "6 cans") — Receipt
   *  Intelligence Foundation. Populated by the same AI pipeline as `unit`, only for
   *  pre-packaged items (see CLAUDE.md §6's packaged-vs-variable-weight distinction) —
   *  null for loose/variable-weight items and for historical rows predating the pipeline
   *  change. */
  pack_size: string | null;
  unit_price: string | null;
  item_total: string;
  created_at: string;
  updated_at: string;
};
