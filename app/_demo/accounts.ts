export interface Account {
  name: string;
  type: "Savings" | "Investment" | "CreditCard" | "LoanToOthers";
  currency: string;
  balance: number;
}

export const ACCOUNTS: Account[] = [
  { name: "MariBank Thama", type: "Savings", currency: "SGD", balance: 31.88 },
  { name: "POSB Bank", type: "Savings", currency: "SGD", balance: 8848.8 },
  { name: "Cash", type: "Savings", currency: "SGD", balance: 74.0 },
  { name: "MariBank", type: "Savings", currency: "SGD", balance: 1028.32 },
  { name: "POSB MF", type: "Investment", currency: "SGD", balance: 13000 },
  { name: "HSBC Credit Card", type: "CreditCard", currency: "SGD", balance: -29.82 },
  { name: "POSB Credit Card", type: "CreditCard", currency: "SGD", balance: -246.54 },
  { name: "SC Credit Card", type: "CreditCard", currency: "SGD", balance: -131.51 },
  { name: "Mari Credit Card", type: "CreditCard", currency: "SGD", balance: -1209.2 },
  { name: "Citi Credit Card", type: "CreditCard", currency: "SGD", balance: -49.83 },
  { name: "Loan - Lokesh", type: "LoanToOthers", currency: "SGD", balance: 100 },
  { name: "SBI Bank", type: "Savings", currency: "INR", balance: 3406.46 },
  { name: "ICICI Bank", type: "Savings", currency: "INR", balance: 7318.22 },
  { name: "HDFC Bank", type: "Savings", currency: "INR", balance: 7778.05 },
  { name: "Kotak Bank", type: "Savings", currency: "INR", balance: 15277.7 },
  { name: "Axis Bank", type: "Savings", currency: "INR", balance: 28919.24 },
  { name: "Cash - INR", type: "Savings", currency: "INR", balance: 900 },
  { name: "ICICI Direct", type: "Investment", currency: "INR", balance: 400000 },
  { name: "Kotak Security", type: "Investment", currency: "INR", balance: 30000 },
  { name: "Kuvera", type: "Investment", currency: "INR", balance: 1300000 },
  { name: "Upstox", type: "Investment", currency: "INR", balance: 50000 },
  { name: "SBI Security", type: "Investment", currency: "INR", balance: 200000 },
  { name: "Zerodha", type: "Investment", currency: "INR", balance: 4000000 },
  { name: "Indmoney", type: "Investment", currency: "INR", balance: 500000 },
  { name: "SBI PPF", type: "Investment", currency: "INR", balance: 900000 },
  { name: "Coin", type: "Investment", currency: "INR", balance: 1800000 },
  { name: "HDFC Credit Card", type: "CreditCard", currency: "INR", balance: 0 },
  { name: "Loan - Venkatesh", type: "LoanToOthers", currency: "INR", balance: 150000 },
  { name: "Moomoo", type: "Investment", currency: "USD", balance: 40000 },
  { name: "IBKR", type: "Investment", currency: "USD", balance: 8000 },
  { name: "Travel Wallet - MYR", type: "Savings", currency: "MYR", balance: 0 },
  { name: "Travel Wallet - IDR", type: "Savings", currency: "IDR", balance: 0 },
  { name: "Travel Wallet - THB", type: "Savings", currency: "THB", balance: 0 },
];
