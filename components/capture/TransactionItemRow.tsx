"use client";

import { ChevronDown } from "lucide-react";
import { cn, withCurrent } from "@/lib/utils";

/**
 * A single line item's draft state. Deliberately narrow today (Transaction Workspace
 * Foundation) — qty is one free-text field combining value + unit. Future Receipt
 * Intelligence will extend this with Quantity, Unit, Pack Size, and Unit Price as their
 * own fields; this type and TransactionItemRow are the one place that split will happen,
 * not a redesign of ReviewScreen itself.
 */
export type ItemDraft = {
  description: string;
  /** Free text combining value and unit, e.g. "0.546 kg", "2 pcs", "500 ml". */
  qty: string;
  amount: string;
  primaryCategory: string;
  secondaryCategory: string;
  /** Receipt Intelligence Foundation — new, nullable item attributes. Accepted here so
   *  this component is ready for a future milestone to render them, but deliberately
   *  NOT rendered yet (no JSX below uses them). Always null today. */
  unit?: string | null;
  packSize?: string | null;
  unitPrice?: string | null;
};

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Qty is free text ("0.5 kg", "2 pcs"); flag it only when its leading number is negative. */
export function qtyIsNegative(qty: string): boolean {
  const match = qty.trim().match(/^-?\d*\.?\d+/);
  return match !== null && Number(match[0]) < 0;
}

export function TransactionItemRow({
  item,
  isOpen,
  onToggle,
  onChange,
  onDelete,
  isOnlyItem,
  primaryOptions,
  secondaryOptionsFor,
}: {
  item: ItemDraft;
  isOpen: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<ItemDraft>) => void;
  /** Individual Line Item Deletion (Transaction Workspace Final UX Polish) — omitted
   *  entirely (no button rendered) when this is the last remaining item, so a receipt
   *  can never be edited down to zero items (ReviewScreen already requires at least one). */
  onDelete?: () => void;
  /** True only when this is the sole remaining item — shows why no delete button exists
   *  instead of leaving its absence unexplained. */
  isOnlyItem?: boolean;
  primaryOptions: string[];
  secondaryOptionsFor: (primary: string) => string[];
}) {
  const amountNum = item.amount.trim() !== "" ? Number(item.amount) : null;
  // Unit price isn't retained past the AI result (reviewed-from-result.ts discards it —
  // only the line total survives into ItemDraft), so this never fabricates a "qty × unit
  // price" reading; it falls back to plain qty. Secondary Category only — Primary
  // ("Groceries") is deliberately never repeated here, since every item in this list
  // already sits under that same primary category by construction.
  const line2 = [item.qty || null, item.secondaryCategory || null].filter(Boolean).join(" • ");

  return (
    <div>
      {/* Collapsed — a receipt row, not a card: typography, spacing, and the shared
          divide-y hairline only. Tapping anywhere on the row expands it for editing and
          collapses whichever other row was open (single expandedItem index upstream). */}
      <button type="button" onClick={onToggle} aria-expanded={isOpen} className="flex w-full flex-col gap-1.5 py-3.5 text-left">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-[14.5px] font-semibold leading-snug">{item.description || "Untitled item"}</p>
          <span
            className={cn("flex-none font-mono text-[15.5px] font-bold tabular-nums", amountNum !== null && amountNum < 0 && "text-destructive")}
          >
            {amountNum !== null ? fmt(amountNum) : "—"}
          </span>
        </div>
        {line2 && (
          <p
            className={cn("truncate text-[11.5px] text-muted-foreground", qtyIsNegative(item.qty) && "font-semibold text-destructive")}
            role={qtyIsNegative(item.qty) ? "alert" : undefined}
          >
            {line2}
          </p>
        )}
      </button>

      {/* Expanded — the exact same editable controls as before; only a light background
          tint marks the editing area, not a card. */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out motion-reduce:transition-none motion-reduce:duration-0"
        style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="mb-2.5 rounded-[var(--radius-md)] bg-secondary/40 p-3.5">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Item name</p>
            <input
              value={item.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="Description"
              className="w-full truncate bg-transparent text-[14px] font-bold outline-none placeholder:text-muted-foreground/60 focus:text-primary"
            />

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {(item.qty || qtyIsNegative(item.qty)) && (
                <input
                  value={item.qty}
                  onChange={(e) => onChange({ qty: e.target.value })}
                  placeholder="Qty"
                  className={cn(
                    "w-16 flex-none rounded-full bg-primary/15 px-2 py-[3px] text-center font-mono text-[10.5px] font-semibold text-primary outline-none",
                    qtyIsNegative(item.qty) && "bg-destructive/15 text-destructive"
                  )}
                />
              )}
              {!item.qty && !qtyIsNegative(item.qty) && (
                <input
                  value={item.qty}
                  onChange={(e) => onChange({ qty: e.target.value })}
                  placeholder="+ qty"
                  className="w-16 flex-none rounded-full border border-dashed border-border px-2 py-[3px] text-center font-mono text-[10.5px] text-muted-foreground outline-none focus:border-primary focus:text-primary"
                />
              )}
              <CategoryPicker
                primary={item.primaryCategory}
                secondary={item.secondaryCategory}
                primaryOptions={withCurrent(primaryOptions, item.primaryCategory)}
                secondaryOptions={withCurrent(secondaryOptionsFor(item.primaryCategory), item.secondaryCategory)}
                onPrimaryChange={(primary) => {
                  // Keep the subcategory only if it belongs to the new category.
                  const keepSecondary = secondaryOptionsFor(primary).includes(item.secondaryCategory);
                  onChange({ primaryCategory: primary, secondaryCategory: keepSecondary ? item.secondaryCategory : "" });
                }}
                onSecondaryChange={(secondary) => onChange({ secondaryCategory: secondary })}
              />
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Amount</p>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={item.amount}
                onChange={(e) => onChange({ amount: e.target.value })}
                placeholder="0.00"
                className={cn(
                  "flex-1 bg-transparent text-right font-mono text-[16px] font-bold tabular-nums outline-none",
                  "placeholder:text-muted-foreground/60 focus:text-primary",
                  item.amount.trim() !== "" && Number(item.amount) < 0 && "text-destructive"
                )}
              />
            </div>

            {onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                className="mt-3 w-full border-t border-border/60 pt-3 text-center text-[11.5px] font-semibold text-destructive"
              >
                Delete Item
              </button>
            ) : (
              isOnlyItem && (
                <p className="mt-3 border-t border-border/60 pt-3 text-center text-[11px] text-muted-foreground">
                  At least one item is required — this is the only one left.
                </p>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Primary → Secondary category picker — two native selects (keeps exact keyboard/
 * accessibility/mobile-picker behavior), visually stacked with a connecting chevron so
 * it reads as one hierarchical "pick a category" control rather than two independent
 * form fields.
 */
function CategoryPicker({
  primary,
  secondary,
  primaryOptions,
  secondaryOptions,
  onPrimaryChange,
  onSecondaryChange,
}: {
  primary: string;
  secondary: string;
  primaryOptions: string[];
  secondaryOptions: string[];
  onPrimaryChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-none items-center gap-1 rounded-full bg-secondary py-[3px] pl-2.5 pr-1.5">
      <select
        value={primary}
        onChange={(e) => onPrimaryChange(e.target.value)}
        className="max-w-[110px] bg-transparent text-[10.5px] font-bold text-foreground outline-none"
      >
        <option value="">Category</option>
        {primaryOptions.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <ChevronDown size={10} strokeWidth={2.5} className="flex-none text-muted-foreground" aria-hidden="true" />
      <select
        value={secondary}
        onChange={(e) => onSecondaryChange(e.target.value)}
        className="max-w-[110px] bg-transparent text-[10.5px] font-medium text-muted-foreground outline-none"
      >
        <option value="">Subcategory</option>
        {secondaryOptions.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
