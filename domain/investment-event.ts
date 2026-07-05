export type InvestmentEvent = {
  id: string;
  account_id: string;
  event_date: string;
  event_type: string;
  capital_amount: string;
  profit_amount: string;
  loss_amount: string;
  dividend_amount: string;
  currency: string;
  exchange_rate: string;
  sgd_amount: string;
  remarks: string | null;
  created_at: string;
};
