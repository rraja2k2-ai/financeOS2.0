# Receipt Item Contract — Extraction Examples

Permanent reference for the Gemini Receipt Intelligence Contract (see
`prompts/receipt-processing.prompt.ts`'s "ITEM EXTRACTION PRINCIPLE" rules and
`services/ai/ai-provider.ts`'s `CaptureReceiptResult.items[]` doc comments). This file is
documentation only — it is not executed and not imported by any code. Its purpose is to
give a future prompt-tuning pass a fixed, permanent catalogue of expected behavior to
regression-test against, so accuracy work never has to rediscover what "correct" means
for each product shape from scratch.

## The principle, restated

Gemini extracts **facts printed on the receipt**. It never calculates, normalizes, or
infers:

- `qty` — how many of `unit` were bought (a discrete count), or the measured amount
  itself for a loose/variable-weight item.
- `unit` — the discrete package word (`"bag"`, `"bottle"`, `"pack"`, `"box"`, `"can"`,
  `"tray"`, `"bundle"`, `"pair"`, `"set"`, `"pc"`) for a pre-packaged item, or the measure
  itself (`"kg"`, `"g"`, `"L"`, `"ml"`) for a loose/variable-weight item with no fixed
  package.
- `packSize` — the pre-packaged size **exactly as printed** (`"5 kg"`, `"2 L"`, `"12s"`).
  Only exists for a fixed pre-packaged item. A loose/variable-weight item has none — its
  `qty` + `unit` already **are** the measured amount.
- `unitPrice` — the per-unit rate **exactly as printed** (e.g. `"$8.40/kg"` → `8.40`).
  Null whenever no per-unit rate is printed. Never `lineAmount ÷ qty`.

**Packaged product vs. variable-weight product — the one distinction that matters most:**
a packaged product's printed size describes the *package*, not what was counted (`qty`
stays a small integer, almost always `1`; the size goes in `packSize`). A variable-weight
product's printed number describes the *actual measured amount purchased* — there is no
package to separately describe, so that number and its unit go directly into `qty` and
`unit`, and `packSize` is null.

## Confirmed against real receipts

These were captured live via `npm run ai:test:capture:c2 -- "<path>"` against the
project's real test receipts (`Bill1.jpeg`, `Bill2.jpg`, `Bill3.jpg`, `Bill4.jpeg` under
the user's Downloads) during this milestone's verification — not fabricated.

| Printed as | description | qty | unit | packSize | unitPrice | Source |
|---|---|---|---|---|---|---|
| "OOTY GOLD PONNI PARBOILED RICE ... 5KG" | Ooty Gold Ponni Parboiled Rice | `1` | `"bag"` | `"5KG"` | `12.9` | Bill1 |
| "Royal Power Rice (Green) Ponni Rice ... 5kg" | Royal Power Rice (Green) Ponni Rice | `1` | `"bag"` | `"5kg"` | `7.9` | Bill2 |
| "INDIAN KOVAKKAI 0.26 kg @ $5.80/kg" | Indian Kovakkai (loose vegetable) | `0.26` | `"kg"` | `null` | `5.8` | Bill1 |
| "RAW MANGO 0.24 kg @ $6.50/kg" | Raw Mango (loose) | `0.24` | `"kg"` | `null` | `6.5` | Bill1 |
| "DRUMSTICKS 0.15 kg @ $9.80/kg" | Drumsticks (loose) | `0.15` | `"kg"` | `null` | `9.8` | Bill1 |
| "M BEANS 0.30 kg @ $6.50/kg" | Mixed Beans (loose) | `0.3` | `"kg"` | `null` | `6.5` | Bill1 |
| "HB MUSTARD SEED ... 100G" | HB Mustard Seed | `1` | `"pack"` | `"100G"` | `1.2` | Bill1 |
| "AJMIR FINE MIXTURE ... 400G" | Ajmir Fine Mixture | `1` | `"pack"` | `"400G"` | `3.5` | Bill1 |
| "Egg ... 30pcs" | Egg | `1` | `"pack"` | `"30pcs"` | `null` (no per-egg rate printed) | Bill4 |
| "Splendid Kitchen Towel ... 60s" | Splendid Kitchen Towel | `1` | `"pack"` | `"60s"` | `3.95` | Bill2 |
| "Medium Logo Plastic Bag" (flat fee, no size printed) | Medium Logo Plastic Bag | `1` | `"bag"` | `null` | `0.05` | Bill2 |
| Restaurant menu line (e.g. "Chicken Tikka x3") — a dish, not a measured/packaged good | Chicken Tikka | `3` | `null` | `null` | `16` (per-dish price) | Bill3 |

The restaurant case (Bill3) is a useful edge case beyond the milestone's own worked
examples: a plated dish has no natural package word, and Gemini correctly left `unit`
null rather than inventing `"serving"` or `"pc"` — confirming the "never infer a value
that isn't printed" rule holds even when a unit would be easy to guess.

## Illustrative (from the milestone brief; not yet run against a real receipt)

These extend the confirmed set to the remaining product categories the milestone asked
this catalogue to cover. Use them as the first regression cases when a future prompt-
tuning milestone starts testing against real receipts of these types.

| Category | Printed as | qty | unit | packSize | unitPrice |
|---|---|---|---|---|---|
| Liquids / Milk | "Milk 2 L" | `1` | `"bottle"` | `"2 L"` | as printed, else `null` |
| Multi-pack / Soft drinks | "Coke 6x330ml" | `1` | `"pack"` | `"6x330ml"` | as printed, else `null` |
| Loose produce | "Bananas 0.62 kg" | `0.62` | `"kg"` | `null` | as printed per-kg rate, else `null` |
| Meat (variable weight) | "Chicken 1.356 kg @ $8.40/kg" | `1.356` | `"kg"` | `null` | `8.40` |
| Meat (pre-packaged) | "Chicken Breast Tray 500g" | `1` | `"tray"` | `"500g"` | as printed, else `null` |
| Fish (variable weight) | "Salmon Fillet 0.42 kg @ $22.00/kg" | `0.42` | `"kg"` | `null` | `22.00` |
| Fish (pre-packaged) | "Frozen Prawns 400g" | `1` | `"pack"` | `"400g"` | as printed, else `null` |
| Bakery | "Sliced White Bread 600g" | `1` | `"pack"` | `"600g"` | as printed, else `null` |
| Cleaning products | "Dish Soap 750ml" | `1` | `"bottle"` | `"750ml"` | as printed, else `null` |
| Household products | "Toilet Paper 12 Rolls" | `1` | `"pack"` | `"12 Rolls"` | as printed, else `null` |
| No size/qty signal at all | A flat line-total item with nothing printed | `null` | `null` | `null` | `null` |

## What NOT to do (regression guardrails)

- Never turn "Rice 5 kg" into `qty=5, unit="kg"` — that reads the package size as a
  quantity. It must be `qty=1, unit="bag", packSize="5 kg"`.
- Never compute `unitPrice` as `lineAmount / qty` when both happen to be known — only a
  rate actually printed on the receipt belongs in `unitPrice`.
- Never default an absent `qty`/`unit`/`packSize` to a guessed value (`1`, `"pc"`, etc.)
  just because the item obviously has *some* quantity — absent stays `null`.
- Never invent a `unit` for something with no natural package word (a restaurant dish, a
  service charge) — `null` is correct there, not a fabricated `"serving"` or `"pc"`.
