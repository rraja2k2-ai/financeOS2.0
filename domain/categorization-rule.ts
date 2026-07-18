export type CategorizationRule = {
  id: string;
  merchant_pattern: string;
  primary_category: string;
  secondary_category: string | null;
  default_account_hint: string | null;
  transaction_type: string;
  priority: number;
  is_active: boolean;
  created_at: string;
};
