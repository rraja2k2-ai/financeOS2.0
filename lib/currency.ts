/**
 * Currency display symbols — presentation only, no numeric formatting here. Each screen
 * keeps its own amount formatter (thousands separators, decimal places); this only
 * supplies the prefix to put in front of it, so "SGD 17.15"-style repeated currency
 * codes can become "$17.15" without duplicating number-formatting logic per screen.
 *
 * Unmapped currencies fall back to the code itself plus a trailing space (e.g. "XYZ "),
 * matching how every currency was displayed before this map existed — nothing regresses
 * for a currency not yet in this list.
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  SGD: "$",
  USD: "US$",
  INR: "₹",
  MYR: "RM",
  THB: "฿",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  IDR: "Rp",
  VND: "₫",
};

/** The prefix to place directly before a formatted amount, e.g. `${currencyPrefix(code)}${fmt(amount)}`. */
export function currencyPrefix(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? `${code} `;
}
