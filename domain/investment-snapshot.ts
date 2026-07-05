export type InvestmentSnapshot = {
  id: string;
  account_id: string;
  snapshot_month: string;
  currency: string;
  market_value: string;
  exchange_rate: string;
  market_value_sgd: string;
  remarks: string | null;
  created_at: string;
};
