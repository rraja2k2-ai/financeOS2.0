import {
  Banknote,
  BadgePercent,
  Building2,
  Car,
  Clapperboard,
  GraduationCap,
  HandCoins,
  HeartHandshake,
  HeartPulse,
  Home,
  Lightbulb,
  Package,
  PiggyBank,
  Receipt as ReceiptIcon,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  TrendingUp,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

/**
 * Icon per primary category (constants/categories.ts) — presentation only, falls back
 * to a generic receipt for anything unmapped. Single source of truth shared by
 * Activity/Account Detail's TransactionCard and Dashboard's Recent Transactions, so
 * neither ever defines a second copy of this map (CLAUDE.md §8).
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "Cashback & Rewards": BadgePercent,
  "Interest Income": PiggyBank,
  Investments: TrendingUp,
  "Rental Income": Building2,
  Salary: Banknote,
  Education: GraduationCap,
  "Family Support": HeartHandshake,
  "Food & Dining": UtensilsCrossed,
  Groceries: ShoppingBasket,
  Healthcare: HeartPulse,
  Housing: Home,
  "Housing & Utilities": Lightbulb,
  Insurance: ShieldCheck,
  "Leisure & Entertainment": Clapperboard,
  Lending: HandCoins,
  Miscellaneous: Package,
  Shopping: ShoppingBag,
  Transportation: Car,
};

export function categoryIcon(primary: string | null): LucideIcon {
  return (primary && CATEGORY_ICONS[primary]) || ReceiptIcon;
}
