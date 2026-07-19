export type AccountMappingRule = {
  id: string;
  /** Free-text keyword — a payment keyword (PAYNOW, NETS, ATM) or a card's last 4 digits (2148). Matches if it appears anywhere in the extracted payment text/user context. */
  keyword: string;
  /** Exact account name from the accounts table. */
  mapped_account: string;
  is_active: boolean;
  created_at: string;
};
