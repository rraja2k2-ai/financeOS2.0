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
  unit_price: string;
  item_total: string;
  created_at: string;
  updated_at: string;
};
