"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Account } from "@/domain/account";
import { correctAccountBalanceAction } from "@/app/settings/accounts/actions";

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const inputClass = "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-primary";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

/**
 * Adjust/Correct Balance — the ONE user-facing way to change Current Balance (Decision 1,
 * Master Data & Account Management Refactor). Shared by Settings → Accounts (Edit dialog)
 * and Account Detail (§7: header-level action) so there is exactly one implementation of
 * this workflow, never a second copy per entry point. Two steps in one small form: enter
 * the actual balance, then confirm the computed difference before it's saved as a real
 * system-generated Adjustment transaction (services/finance/balance-correction.service.ts).
 * There is nothing to discard on Cancel at either step — nothing is written until Confirm.
 */
export function CorrectBalanceForm({
  account,
  onDone,
  onCancel,
}: {
  account: Account;
  onDone: (updated: Account) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [newBalanceInput, setNewBalanceInput] = useState(Number(account.current_balance).toFixed(2));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const previousBalance = Number(account.current_balance);
  const newBalance = Number(newBalanceInput);
  const validAmount = newBalanceInput.trim() !== "" && Number.isFinite(newBalance);
  const difference = validAmount ? round2(newBalance - previousBalance) : 0;

  function handleContinue() {
    if (!validAmount) {
      setError("Enter a valid balance.");
      return;
    }
    if (difference === 0) {
      setError("That matches the current balance — nothing to correct.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setError(null);
    setStep("confirm");
  }

  function handleConfirm() {
    setPending(true);
    setError(null);
    correctAccountBalanceAction(account.id, newBalance, reason)
      .then(onDone)
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Could not correct the balance.");
        setPending(false);
      });
  }

  if (step === "enter") {
    return (
      <div className="mt-3 space-y-3">
        <div>
          <label className={labelClass}>Current balance</label>
          <p className={cn(inputClass, "flex items-center text-muted-foreground")}>
            {account.currency} {fmt(previousBalance)}
          </p>
        </div>
        <div>
          <label className={labelClass}>Actual balance</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            autoFocus
            className={inputClass}
            value={newBalanceInput}
            onChange={(e) => setNewBalanceInput(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Reason (required)</label>
          <input
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Bank statement reconciliation"
          />
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          The reason becomes the reference on a new Adjustment transaction, visible in Activity.
        </p>
        {error && <p className="text-[12px] font-semibold text-destructive">{error}</p>}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleContinue}
            className="flex-1 rounded-lg bg-primary py-2 text-[13px] font-semibold text-primary-foreground"
          >
            Continue
          </button>
          <button type="button" onClick={onCancel} className="flex-1 rounded-lg border border-border py-2 text-[13px] font-semibold">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-lg border border-border bg-background p-3 text-[12.5px]">
        <div className="flex items-center justify-between py-1">
          <span className="text-muted-foreground">Previous Balance</span>
          <span className="font-mono font-semibold tabular-nums">
            {account.currency} {fmt(previousBalance)}
          </span>
        </div>
        <div className="flex items-center justify-between py-1">
          <span className="text-muted-foreground">New Balance</span>
          <span className="font-mono font-semibold tabular-nums">
            {account.currency} {fmt(newBalance)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between border-t border-border pt-2">
          <span className="font-semibold">Difference</span>
          <span className={cn("font-mono font-bold tabular-nums", difference > 0 ? "text-primary" : "text-destructive")}>
            {difference > 0 ? "+" : ""}
            {account.currency} {fmt(difference)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between border-t border-border pt-2">
          <span className="text-muted-foreground">Reason</span>
          <span className="max-w-[60%] truncate text-right font-semibold">{reason.trim()}</span>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        This creates an Adjustment transaction for the difference, visible in Activity — the same as any other transaction.
      </p>
      {error && <p className="text-[12px] font-semibold text-destructive">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={pending}
          onClick={handleConfirm}
          className="flex-1 rounded-lg bg-primary py-2 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Saving…" : "Confirm"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setStep("enter")}
          className="flex-1 rounded-lg border border-border py-2 text-[13px] font-semibold disabled:opacity-50"
        >
          Back
        </button>
      </div>
    </div>
  );
}
