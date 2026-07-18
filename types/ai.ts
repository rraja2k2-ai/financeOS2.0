/**
 * AI pipeline types (TAD-005). Phase 1 Extraction produces facts only (no categories,
 * no UUIDs); Phase 2 Classification enriches with categories/tags. The server owns all
 * identifiers, amounts conversion, and persistence — these types are AI *suggestions*
 * until validated server-side.
 */

/** transaction_headers.transaction_type domain. "Income" is not yet a stored value — see budget-taxonomy memo. */
export type TransactionType = "Expense" | "Payment" | "Transfer" | "Lending";

/**
 * Optional free-text context the user types alongside a capture (TAD-007 §5).
 * e.g. "bought fish 500g 23 dollars using posb bank" or "paid from Mari credit card".
 * There are NO dropdowns — this is the only hint channel. Extraction reads it as
 * additional context; conflicts with the receipt surface as warnings, not overrides.
 */
export type CaptureHints = {
  freeText?: string;
};

export type ExtractedLineItem = {
  description: string;
  /** Free-text quantity as printed: "2 pc", "500g", "0.5 kg", "1". */
  qty: string;
  /** Numeric unit price in the transaction currency; null if not itemized. */
  unitPrice: number | null;
  /** Numeric line total in the transaction currency. */
  itemTotal: number;
};

/** Phase 1 output — facts extracted from a receipt / PDF / voice / free text. */
export type ExtractionResult = {
  merchant: string;
  /** ISO date "YYYY-MM-DD"; null if the source shows no date (server defaults to today). */
  transactionDate: string | null;
  /** ISO 4217 code, e.g. "SGD", "INR". Uppercased. */
  currency: string;
  /** Final amount actually paid (after discounts). Always the payable total. */
  totalAmount: number;
  transactionType: TransactionType;
  /** Free-text hint about the payment account, e.g. "POSB", "Mari credit card". Not a UUID. */
  paymentHint: string | null;
  /** Free-text hint about the project, e.g. "Thailand trip". Not a UUID. */
  projectHint: string | null;
  lineItems: ExtractedLineItem[];
  /** 0..1 self-reported extraction confidence. Drives whether the capture auto-saves or lands in Needs You. */
  confidence: number;
  /** Human-readable notes: hint/receipt conflicts, unreadable fields, assumptions made. */
  warnings: string[];
};

/** A single category assignment from Phase 2, at line-item level. */
export type ItemClassification = {
  /** Must be a valid pair from the budget taxonomy (constants/categories.ts). */
  primaryCategory: string;
  secondaryCategory: string | null;
  tags: string[];
  searchKeywords: string[];
};

/** Phase 2 output — enrichment of a verified extraction. Never returns UUIDs. */
export type ClassificationResult = {
  /** Dominant/summary category for the header (display only — see TAD-003 §11.2). */
  headerPrimaryCategory: string;
  /** Per-line-item classification, aligned by index to the extraction's lineItems. */
  items: ItemClassification[];
  /** Free-text suggested account/project names for the server to resolve to UUIDs. */
  suggestedAccountName: string | null;
  suggestedProjectName: string | null;
  confidence: number;
  warnings: string[];
};

/** The valid category universe handed to Phase 2 (derived from budget rows). */
export type CategoryOption = {
  primary: string;
  /** Sub-categories valid under this primary; may include null-allowed for whole-store. */
  subcategories: string[];
};
