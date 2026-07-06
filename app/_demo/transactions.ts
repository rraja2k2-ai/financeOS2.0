export interface TransactionItem {
  name: string;
  amt: number;
}

export interface Transaction {
  merchant: string;
  date: string;
  currency: string;
  amount: number;
  category: string;
  icon: string;
  items: TransactionItem[];
}

export const TRANSACTIONS: Transaction[] = [
  {
    merchant: "NTUC FairPrice",
    date: "Jul 5",
    currency: "SGD",
    amount: -42.3,
    category: "Groceries",
    icon: "shopping_cart",
    items: [
      { name: "Milk 1L", amt: -4.2 },
      { name: "Bread", amt: -3.1 },
      { name: "Eggs", amt: -6.5 },
      { name: "Vegetables", amt: -28.5 },
    ],
  },
  {
    merchant: "Grab",
    date: "Jul 5",
    currency: "SGD",
    amount: -18.6,
    category: "Transport",
    icon: "directions_car",
    items: [{ name: "Ride to office", amt: -18.6 }],
  },
  {
    merchant: "Starbucks",
    date: "Jul 4",
    currency: "SGD",
    amount: -7.8,
    category: "Dining",
    icon: "local_cafe",
    items: [{ name: "Flat white", amt: -6.5 }, { name: "GST", amt: -1.3 }],
  },
  {
    merchant: "HSBC Credit Card Payment",
    date: "Jul 3",
    currency: "SGD",
    amount: -500.0,
    category: "Payment",
    icon: "credit_card",
    items: [{ name: "Credit card payment", amt: -500.0 }],
  },
  {
    merchant: "Salary",
    date: "Jul 1",
    currency: "SGD",
    amount: 12700.0,
    category: "Income",
    icon: "payments",
    items: [{ name: "Regular salary", amt: 12700.0 }],
  },
  {
    merchant: "Amazon India",
    date: "Jul 4",
    currency: "INR",
    amount: -1450.0,
    category: "Shopping",
    icon: "shopping_bag",
    items: [{ name: "Phone case", amt: -450 }, { name: "USB cable", amt: -1000 }],
  },
  {
    merchant: "Swiggy",
    date: "Jul 3",
    currency: "INR",
    amount: -620.0,
    category: "Dining",
    icon: "restaurant",
    items: [{ name: "Dinner order", amt: -580 }, { name: "Delivery fee", amt: -40 }],
  },
  {
    merchant: "Apollo Pharmacy",
    date: "Jul 2",
    currency: "INR",
    amount: -340.0,
    category: "Healthcare",
    icon: "medication",
    items: [{ name: "Medicines", amt: -340 }],
  },
];
