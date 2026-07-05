export type TransactionHeader = {
  id: string;
  receipt_id: string;
  transaction_date: string;
  merchant: string;
  transaction_type: string;
  primary_category: string;
  source_account_id: string;
  target_account_id: string | null;
  project_id: string | null;
  currency: string;
  original_amount: string;
  exchange_rate: string | null;
  sgd_total_amount: string;
  comments: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};
