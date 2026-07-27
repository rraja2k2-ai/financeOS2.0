/**
 * Provider-agnostic AI contract for the premium Capture flow (C2).
 *
 * Rule: nothing outside services/ai may know which provider is active. UI, capture
 * service, and API routes depend on THIS interface only; concrete providers live in
 * services/ai/providers/ and are selected exclusively by the factory in
 * providers/index.ts. Future providers: Claude, OpenAI, Azure Document Intelligence —
 * adding one must touch services/ai/providers/ and nothing else.
 */

/** One page/file of a captured receipt, as the provider will receive it. */
export type CaptureDocumentPage = {
  /** e.g. "image/jpeg", "image/png", "application/pdf" */
  mimeType: string;
  /** base64-encoded bytes, without the data: URI prefix */
  dataBase64: string;
};

/**
 * FinanceOS master data snapshot, loaded ONCE per Capture Session (by
 * services/capture/master-data.service.ts) and reused for the whole session — the AI
 * layer itself never queries the database.
 */
export type CaptureMasterData = {
  baseCurrency: string;
  categories: {
    primary: string;
    categoryType: "income" | "expense";
    subcategories: string[];
  }[];
  accounts: {
    name: string;
    type: string;
    currency: string;
  }[];
  projects: {
    name: string;
    description: string | null;
  }[];
  categorizationRules: {
    merchantPattern: string;
    primaryCategory: string;
    secondaryCategory: string | null;
    accountHint: string | null;
  }[];
  /**
   * Fix 4 (Simple Account Mapping Rules) — flat keyword -> account hints for
   * headerSuggestions.account ONLY. Not a rule engine: no merchant/category rules,
   * no priority, no chaining. See prompts/receipt-processing.prompt.ts for the
   * matching order the AI is instructed to apply.
   */
  accountMappingRules: {
    keyword: string;
    account: string;
  }[];
};

/** Everything the user handed us in the Capture modal, plus the session's master data. */
export type CaptureProcessingInput = {
  /** Free-text AI context, e.g. "Paid using POSB. Thailand holiday." May be empty. */
  userContext: string;
  /** The receipt's pages (0..n — all pages of ONE receipt, sent in ONE request). */
  pages: CaptureDocumentPage[];
  masterData: CaptureMasterData;
};

/** The validated, structured result of processing one receipt (the C2 JSON contract). */
export type CaptureReceiptResult = {
  header: {
    merchant: string | null;
    transactionDate: string | null;
    currency: string | null;
    paymentMethod: string | null;
    total: number | null;
    tax: number | null;
    discount: number | null;
    notes: string | null;
    /** One of the 5 constants.TRANSACTION_TYPES values, or null if the AI couldn't
     *  classify it — normalizeReceiptResult() defaults null/invalid to EXPENSE
     *  (Transaction Type Intelligence Pipeline milestone). */
    transactionType: string | null;
  };
  items: {
    description: string;
    /** How many of `unit` were actually purchased — a discrete count (e.g. 1 bag, 2
     *  cans) OR the measured amount itself for a loose/variable-weight item (e.g. 1.356
     *  for 1.356 kg of loose chicken). NEVER the package's printed size — see `unit` and
     *  `packSize` below (Gemini Receipt Intelligence Contract). */
    qty: number | null;
    /** The discrete unit `qty` counts: a purchasable unit ("bag", "bottle", "pack",
     *  "box", "can", "tray", "bundle", "pair", "set", "pc") for a pre-packaged item, OR
     *  the measure itself ("kg", "g", "L", "ml") when the item is sold loose/by variable
     *  weight with no fixed package. Never normalized or converted. */
    unit: string | null;
    /** The pre-packaged size exactly as printed (e.g. "5 kg", "2 L", "6 cans") — ONLY
     *  for a fixed pre-packaged item; null for a loose/variable-weight item, where `qty`
     *  + `unit` already ARE the measured amount and there is no separate package size.
     *  Gemini Receipt Intelligence Contract — facts only, never inferred. */
    packSize: string | null;
    /** The per-unit price exactly as PRINTED on the receipt (e.g. "$8.40/kg" -> 8.40).
     *  Never calculated or derived from lineAmount/qty — null when not printed. */
    unitPrice: number | null;
    lineAmount: number | null;
    primaryCategory: string | null;
    secondaryCategory: string | null;
  }[];
  headerSuggestions: {
    account: string | null;
    project: string | null;
    /** Destination account for a TRANSFER/INCOME (Transaction Type Intelligence Part 2)
     *  — an exact name from ACCOUNTS, or null when the destination is external (a
     *  person, an outside party) or simply not identifiable. Resolved to
     *  target_account_id at save time exactly like `account` resolves to
     *  source_account_id; never a hard validation requirement. */
    destinationAccount: string | null;
  };
  other: {
    tags: string[];
    confidence: number | null;
    summary: string | null;
  };
};

/**
 * What a provider returns: the model's JSON output, parsed but NOT yet shape-validated.
 * Schema validation/normalization is provider-independent and lives in
 * services/capture/capture.service.ts.
 */
export type CaptureProcessingResult = unknown;

/** The single seam every AI provider must implement. */
export interface CaptureAiProvider {
  /** Stable identifier, e.g. "gemini", "claude", "openai", "azure-di". */
  readonly name: string;

  /**
   * Process one captured receipt (+ user context + master data) in ONE multimodal
   * request and return the model's parsed JSON. Throws CaptureAiError on failure.
   */
  processReceipt(input: CaptureProcessingInput): Promise<CaptureProcessingResult>;
}

export type CaptureAiErrorKind =
  | "quota" // rate limit / free-tier quota exhausted
  | "unavailable" // provider outage / network failure
  | "timeout" // request exceeded our time budget
  | "invalid_request" // our request was malformed / rejected
  | "invalid_response" // empty response or unparseable/ill-shaped JSON
  | "unknown";

export class CaptureAiError extends Error {
  readonly kind: CaptureAiErrorKind;
  readonly cause?: unknown;

  constructor(kind: CaptureAiErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "CaptureAiError";
    this.kind = kind;
    this.cause = cause;
  }
}

/** A user-presentable message per error kind (the UI shows these verbatim). */
export function friendlyCaptureError(err: unknown): string {
  if (err instanceof CaptureAiError) {
    switch (err.kind) {
      case "quota":
        return "The AI service has hit today's free quota. Try again later.";
      case "unavailable":
        return "The AI service is temporarily unavailable. Try again in a moment.";
      case "timeout":
        return "Processing took too long and was stopped. Try again.";
      case "invalid_response":
        return "The AI returned a response we couldn't understand. Try again.";
      case "invalid_request":
        return "The receipt couldn't be sent for processing. Check the file and try again.";
      default:
        return "Something went wrong while processing. Try again.";
    }
  }
  return "Something went wrong while processing. Try again.";
}
