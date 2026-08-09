/**
 * Price Intelligence Version 1 — helps compare what was actually paid for the same
 * grocery item over time, purely from this app's own purchase history. Not inventory
 * management, not supermarket price tracking, no AI. Every function here is pure and
 * framework-agnostic (no Supabase, no React) so it works from Activity's existing
 * client-side search/filter architecture without violating "no calculations in the UI" —
 * the UI calls these functions, it never derives the numbers itself.
 *
 * Deliberately independent of transaction_items.unit_price — that column means "the rate
 * printed on the receipt" (CLAUDE.md §6: never computed as lineAmount ÷ qty) and stays
 * untouched. What this file derives is a different, always-recomputed-on-read value.
 *
 * Comparison universe — search decides what's DISPLAYED, this file decides what's
 * COMPARABLE, and those are deliberately two different questions answered by two
 * different functions. `selectComparableCandidates()` below is the narrowing step: given
 * whatever a caller is already displaying (matched however that caller likes — by item
 * text, merchant, category, or anything else) plus an anchor string, it returns only the
 * items whose OWN description contains that anchor. A merchant match ("NTUC") or a
 * category match ("Dairy & Eggs") never puts unrelated products in the same comparison —
 * only an item that itself is textually "about" the anchor qualifies. "Tomato", "Fresh
 * Tomato", and "Organic Tomato" all qualify under anchor "tomato" because each one's own
 * description says so, not because they merely appeared in the same result set.
 * `computePriceIntelligence()` then runs on that already-narrowed set and is completely
 * unaware this narrowing happened — it keeps doing exactly what it always did:
 *   - Same measurement family only — kg/g (weight), L/ml (volume), pc/pcs/piece (count)
 *     are three separate families, never converted or compared across each other.
 *   - Same currency only — comparing SGD/kg against THB/kg without conversion would be
 *     just as dishonest as comparing kg against pieces, so currency is a second axis a
 *     "comparable purchase" must also share (an extension of the same principle).
 *   - A valid derived unit price — an item whose effective unit (see below) is missing or
 *     unrecognized, or whose `qty` doesn't parse, simply doesn't participate, never
 *     estimated or guessed.
 *
 * Missing `unit` fallback: when the `unit` column is null, the trailing text in `qty`
 * itself (e.g. "kg" in "0.856 kg") is tried as the unit instead, through the exact same
 * whitelist as a real `unit` value — never a looser check. This is not an inference; the
 * unit is already explicitly present in that text, just not duplicated into its own
 * column for this row (checked against 500 real `unit = null` rows before adding this:
 * every non-empty trailing token either matched the whitelist exactly or was safely
 * rejected — e.g. "1 5KG" and "1 (250G)", both packaged items where the trailing text
 * isn't a clean unit token, correctly still produce no result). `unit` is always
 * preferred when present; the fallback only applies when it's null.
 */

export type MeasurementFamily = "weight" | "volume" | "count";

export type ItemUnitPrice = {
  valuePerUnit: number;
  family: MeasurementFamily;
  unitLabel: "kg" | "L" | "pc";
};

/** A validated, standard-unit-normalized measurement family — the return shape of
 *  getEffectiveUnit() below. `toStandardUnit` is the multiplier from the original unit to
 *  the family's standard unit (kg, L, pc). */
export type EffectiveUnit = {
  family: MeasurementFamily;
  unitLabel: "kg" | "L" | "pc";
  toStandardUnit: number;
};

/** Version 1's only supported units, grouped into three measurement families that are
 *  never converted or compared across one another. Value is the multiplier to the
 *  family's standard unit (kg, L, pc). Anything not listed here (e.g. "pack", "bag",
 *  "bottle", "ticket") is unrecognized — Unit Price is simply omitted, never guessed. */
const WEIGHT_UNITS_TO_KG: Record<string, number> = { kg: 1, g: 0.001 };
const VOLUME_UNITS_TO_L: Record<string, number> = { l: 1, ml: 0.001 };
const COUNT_UNITS_TO_PC: Record<string, number> = { pc: 1, pcs: 1, piece: 1 };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function measurementFamilyFor(unit: string): EffectiveUnit | null {
  const key = unit.trim().toLowerCase();
  if (key in WEIGHT_UNITS_TO_KG) return { family: "weight", unitLabel: "kg", toStandardUnit: WEIGHT_UNITS_TO_KG[key] };
  if (key in VOLUME_UNITS_TO_L) return { family: "volume", unitLabel: "L", toStandardUnit: VOLUME_UNITS_TO_L[key] };
  if (key in COUNT_UNITS_TO_PC) return { family: "count", unitLabel: "pc", toStandardUnit: COUNT_UNITS_TO_PC[key] };
  return null;
}

/** Splits a free-text qty value into its leading numeric magnitude and whatever text
 *  follows it (e.g. "0.856 kg" -> { magnitude: 0.856, trailingText: "kg" }; "2 pc" ->
 *  { magnitude: 2, trailingText: "pc" }; "1.000" -> { magnitude: 1, trailingText: null }).
 *  Returns null (never a 0/negative magnitude) so a caller can treat "unparsable" and
 *  "not derivable" identically. Mirrors the same leading-number pattern
 *  activity-format.tsx's formatQty() already uses for display — that one returns a
 *  formatted string for a different purpose, so it's kept separate. */
function parseQty(qty: string): { magnitude: number; trailingText: string | null } | null {
  const match = qty.trim().match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude) || magnitude <= 0) return null;
  return { magnitude, trailingText: match[2].trim() || null };
}

/**
 * Determines the effective unit to price a transaction item against — the single source
 * of truth for "what unit is this item in," so any future feature (Grocery Analytics,
 * Pantry, Shopping Lists, AI Insights, ...) needing the same answer reuses this instead of
 * re-implementing the same priority/validation logic. Priority, exactly as today's
 * behavior already establishes — no rule relaxed, no new unit family, no inference beyond
 * what's already explicitly present in the data:
 *   1. The stored `unit` column, always preferred when populated.
 *   2. Otherwise the trailing text already present in `qty` (e.g. "kg" in "0.856 kg") —
 *      not a guess, since the unit is already explicit in that text, just not duplicated
 *      into its own column for that row (see the file header's "Missing unit fallback").
 *   3. Either way, validated against the same three-family whitelist — never a looser
 *      check for the fallback path than for a real `unit` value.
 * Returns null when no supported unit can be determined.
 */
export function getEffectiveUnit(unit: string | null, qty: string): EffectiveUnit | null {
  const candidate = unit ?? parseQty(qty)?.trailingText ?? null;
  return candidate ? measurementFamilyFor(candidate) : null;
}

/**
 * Derives a per-standard-unit price for one transaction item. Returns null whenever it
 * can't be honestly derived — getEffectiveUnit() finds no supported unit, or `qty` doesn't
 * parse to a positive leading number. The absence of a result is the correct answer in
 * that case, not a failure to handle.
 */
export function deriveUnitPrice(qty: string, unit: string | null, itemTotal: number): ItemUnitPrice | null {
  const parsedQty = parseQty(qty);
  if (!parsedQty) return null;

  const effectiveUnit = getEffectiveUnit(unit, qty);
  if (!effectiveUnit) return null;

  const standardQuantity = parsedQty.magnitude * effectiveUnit.toStandardUnit;
  if (standardQuantity <= 0) return null;

  return { valuePerUnit: round2(itemTotal / standardQuantity), family: effectiveUnit.family, unitLabel: effectiveUnit.unitLabel };
}

export type PriceIntelligenceSummary = {
  family: MeasurementFamily;
  unitLabel: "kg" | "L" | "pc";
  currency: string;
  lowestPrice: number;
  highestPrice: number;
  averagePrice: number;
  /** "YYYY-MM-DD" — plain string comparison is correct and sufficient here, same
   *  reasoning dashboard.service.ts already applies to date-string fields elsewhere. */
  lastPurchased: string;
  purchaseCount: number;
};

export type PriceIntelligenceInput = {
  qty: string;
  unit: string | null;
  itemTotal: number;
  currency: string;
  transactionDate: string;
};

/**
 * Narrows any candidate collection down to the items that are themselves textually "about"
 * `anchorText` — a generic, reusable domain helper, not an Activity- or Search-specific
 * one. It knows nothing about merchants, categories, UI, or how the caller assembled its
 * candidate list; it only ever looks at each item's own `description` field. This is the
 * seam a future Product Master would replace (swap this selection step for an exact
 * product-id match) without touching computePriceIntelligence() at all, and the same seam
 * a future Grocery Analytics / Shopping List / Pantry feature can reuse with a different
 * anchor source (see CLAUDE.md's Price Intelligence entry).
 *
 * Matching is case-insensitive substring containment, trimmed on both sides — the same
 * primitive Activity Search's own broad match already uses, just scoped to one field
 * instead of three. Deliberately NOT consolidated with Search's predicate: Search decides
 * what's displayed (item/merchant/category — broad recall), this decides what's honestly
 * comparable (item's own description only — narrow precision). They answer different
 * questions and must stay free to diverge.
 *
 * An empty/blank `anchorText` matches nothing (never "everything"), since an empty anchor
 * has nothing to honestly compare against.
 */
export function selectComparableCandidates<T extends { description: string | null }>(items: T[], anchorText: string): T[] {
  const anchor = anchorText.trim().toLowerCase();
  if (!anchor) return [];
  return items.filter((item) => (item.description ?? "").toLowerCase().includes(anchor));
}

/**
 * Computes Price Intelligence directly over a caller-supplied set of items — the caller
 * (typically `selectComparableCandidates()`'s output) has already decided what's
 * comparable; no second, independent grouping by item description happens inside this
 * function. Items are grouped only by (measurement family, currency) and summarized when
 * 2+ priceable purchases share both — "when multiple comparable purchases exist." A group
 * of fewer than 2 priceable purchases is omitted entirely, not shown as a degenerate
 * one-item summary. Grouping by family and currency, not just currency, is what
 * guarantees a summary can never blend kg with pieces or SGD with THB.
 */
export function computePriceIntelligence(items: PriceIntelligenceInput[]): PriceIntelligenceSummary[] {
  const groups = new Map<string, { family: MeasurementFamily; unitLabel: "kg" | "L" | "pc"; currency: string; prices: number[]; dates: string[] }>();

  for (const item of items) {
    const derived = deriveUnitPrice(item.qty, item.unit, item.itemTotal);
    if (!derived) continue;

    const key = `${derived.family}::${item.currency}`;
    if (!groups.has(key)) {
      groups.set(key, { family: derived.family, unitLabel: derived.unitLabel, currency: item.currency, prices: [], dates: [] });
    }
    const group = groups.get(key)!;
    group.prices.push(derived.valuePerUnit);
    group.dates.push(item.transactionDate);
  }

  const summaries: PriceIntelligenceSummary[] = [];
  for (const group of groups.values()) {
    if (group.prices.length < 2) continue;
    summaries.push({
      family: group.family,
      unitLabel: group.unitLabel,
      currency: group.currency,
      lowestPrice: round2(Math.min(...group.prices)),
      highestPrice: round2(Math.max(...group.prices)),
      averagePrice: round2(group.prices.reduce((sum, p) => sum + p, 0) / group.prices.length),
      lastPurchased: group.dates.reduce((latest, d) => (d > latest ? d : latest), group.dates[0]),
      purchaseCount: group.prices.length,
    });
  }

  return summaries.sort((a, b) => a.family.localeCompare(b.family) || a.currency.localeCompare(b.currency));
}
