"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Account } from "@/domain/account";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { useOverflowMenu } from "@/hooks/useOverflowMenu";
import { ACCOUNT_TYPES, accountTypeLabel } from "@/constants/accounts";
import { ALL_CURRENCIES } from "@/domain/exchange-rate";
import {
  createAccountAction,
  updateAccountAction,
  archiveAccountAction,
  restoreAccountAction,
  deleteAccountAction,
} from "@/app/settings/accounts/actions";
import type { AccountInput } from "@/services/finance/account-management.service";

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

type DialogState = { mode: "add" } | { mode: "edit"; account: Account };

export function SettingsAccountsView({ accounts: initialAccounts }: { accounts: Account[] }) {
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formPending, startFormTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const { anchor: menuAnchor, toggle: toggleMenu, close: closeMenu } = useOverflowMenu();
  const [archiveBusyId, setArchiveBusyId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const visibleAccounts = accounts.filter((a) => showArchived || a.status !== "Inactive");
  const archivedCount = accounts.filter((a) => a.status === "Inactive").length;
  const menuAccount = menuAnchor ? accounts.find((a) => a.id === menuAnchor.id) : undefined;

  function handleCreate(input: AccountInput) {
    setFormError(null);
    startFormTransition(async () => {
      try {
        const created = await createAccountAction(input);
        setAccounts((prev) => [...prev, created]);
        setDialog(null);
        setToast("Account created.");
      } catch (e) {
        setFormError(e instanceof Error ? e.message : "Could not create account.");
      }
    });
  }

  function handleUpdate(id: string, input: AccountInput) {
    setFormError(null);
    startFormTransition(async () => {
      try {
        const updated = await updateAccountAction(id, input);
        setAccounts((prev) => prev.map((a) => (a.id === id ? updated : a)));
        setDialog(null);
        setToast("Account updated.");
      } catch (e) {
        setFormError(e instanceof Error ? e.message : "Could not update account.");
      }
    });
  }

  function handleArchiveToggle(account: Account) {
    closeMenu();
    const archiving = account.status !== "Inactive";
    setArchiveBusyId(account.id);
    startFormTransition(async () => {
      try {
        const updated = archiving ? await archiveAccountAction(account.id) : await restoreAccountAction(account.id);
        setAccounts((prev) => prev.map((a) => (a.id === account.id ? updated : a)));
        setToast(archiving ? "Account archived." : "Account restored.");
      } catch (e) {
        setToast(e instanceof Error ? e.message : "Could not update account.");
      } finally {
        setArchiveBusyId(null);
      }
    });
  }

  function handleDelete(id: string) {
    setDeleteError(null);
    setDeleteBusy(true);
    startFormTransition(async () => {
      try {
        await deleteAccountAction(id);
        setAccounts((prev) => prev.filter((a) => a.id !== id));
        setConfirmingDeleteId(null);
        setToast("Account deleted.");
      } catch (e) {
        setDeleteError(e instanceof Error ? e.message : "Could not delete account.");
      } finally {
        setDeleteBusy(false);
      }
    });
  }

  return (
    <div className="px-5 pt-6 pb-8">
      <SettingsPageHeader
        title="Accounts"
        action={
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setDialog({ mode: "add" });
            }}
            className="rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground"
          >
            Add Account
          </button>
        }
      />

      <button
        type="button"
        onClick={() => setShowArchived((v) => !v)}
        className={cn(
          "mb-3 flex w-full items-center justify-between rounded-[var(--radius-md)] border px-3.5 py-2.5 text-[12px] font-semibold",
          showArchived ? "border-primary bg-accent text-primary" : "border-border bg-card text-muted-foreground"
        )}
      >
        <span>Show Archived ({archivedCount})</span>
        <span>{showArchived ? "Hide" : "Show"}</span>
      </button>

      {visibleAccounts.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
          {accounts.length === 0 ? "No accounts yet." : "No archived accounts."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          {visibleAccounts.map((account, i) => {
            const archived = account.status === "Inactive";
            return (
              <div
                key={account.id}
                className={cn(
                  "relative flex items-center justify-between gap-2 p-4 pr-11",
                  i > 0 && "border-t border-border",
                  archived && "opacity-60"
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{account.account_name}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {accountTypeLabel(account.account_type)} · {account.currency}
                    {archived ? " · Archived" : ""}
                  </p>
                </div>
                <p className="flex-none font-mono text-[13px] font-semibold tabular-nums">
                  {account.currency} {fmt(Number(account.current_balance))}
                </p>
                <button
                  type="button"
                  aria-label="Account actions"
                  title="Account actions"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMenu(account.id, e.currentTarget.getBoundingClientRect());
                  }}
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="12" cy="19" r="1.8" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Link
        href="/accounts"
        className="mt-4 block rounded-[var(--radius-md)] border border-border bg-card p-3.5 text-center text-[13px] font-semibold text-primary"
      >
        View account balances →
      </Link>

      {/* Overflow menu — portal-rendered so it's never clipped by the list's own overflow-hidden. */}
      {menuAnchor &&
        menuAccount &&
        createPortal(
          <div
            className="fixed z-[85] w-44 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card shadow-lg"
            style={{ top: menuAnchor.rect.bottom + 4, left: Math.max(8, menuAnchor.rect.right - 176) }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                closeMenu();
                setFormError(null);
                setDialog({ mode: "edit", account: menuAccount });
              }}
              className="block w-full px-3.5 py-2.5 text-left text-[12.5px] font-semibold"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={archiveBusyId === menuAccount.id}
              onClick={() => handleArchiveToggle(menuAccount)}
              className="block w-full border-t border-border px-3.5 py-2.5 text-left text-[12.5px] font-semibold disabled:opacity-50"
            >
              {archiveBusyId === menuAccount.id ? "Working…" : menuAccount.status === "Inactive" ? "Restore" : "Archive"}
            </button>
            <button
              type="button"
              onClick={() => {
                const id = menuAccount.id;
                closeMenu();
                setDeleteError(null);
                setConfirmingDeleteId(id);
              }}
              className="block w-full border-t border-border px-3.5 py-2.5 text-left text-[12.5px] font-semibold text-destructive"
            >
              Delete
            </button>
          </div>,
          document.body
        )}

      {/* Add / Edit dialog — one form, reused for both (mirrors ProjectForm's create/edit reuse). */}
      {dialog && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/50 px-6 py-10">
          <div className="w-full max-w-[380px] rounded-[var(--radius-lg)] border border-border bg-card p-5">
            <p className="text-[14.5px] font-bold">{dialog.mode === "add" ? "Add Account" : "Edit Account"}</p>
            <AccountForm
              key={dialog.mode === "edit" ? dialog.account.id : "add"}
              initial={dialog.mode === "edit" ? dialog.account : undefined}
              existingNames={accounts.filter((a) => dialog.mode !== "edit" || a.id !== dialog.account.id).map((a) => a.account_name)}
              submitLabel={dialog.mode === "add" ? "Add Account" : "Save Changes"}
              pending={formPending}
              error={formError}
              onSubmit={(input) => (dialog.mode === "add" ? handleCreate(input) : handleUpdate(dialog.account.id, input))}
              onCancel={() => {
                setDialog(null);
                setFormError(null);
              }}
            />
          </div>
        </div>
      )}

      {/* Delete confirmation — Delete Protection's message renders here verbatim if the account has transactions. */}
      {confirmingDeleteId && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-8" role="alertdialog" aria-label="Delete this account?">
          <div className="w-full max-w-[340px] rounded-[var(--radius-lg)] border border-border bg-card p-5">
            <p className="text-[14.5px] font-bold">Delete this account?</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">This action cannot be undone.</p>
            {deleteError && <p className="mt-2.5 text-[12.5px] font-semibold leading-relaxed text-destructive">{deleteError}</p>}
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setConfirmingDeleteId(null);
                  setDeleteError(null);
                }}
                disabled={deleteBusy}
                className="flex-1 rounded-lg border border-border py-2 text-[13px] font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmingDeleteId)}
                disabled={deleteBusy}
                className="flex-1 rounded-lg bg-destructive py-2 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed inset-x-0 z-[80] mx-auto w-fit max-w-[90%] rounded-full bg-foreground px-4 py-2.5 text-[13px] font-semibold text-background shadow-lg"
          style={{ bottom: "calc(96px + env(safe-area-inset-bottom, 0px))" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

const inputClass = "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-primary";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

function AccountForm({
  initial,
  existingNames,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Account;
  /** Other accounts' names (excluding the one being edited) — client-side duplicate
   *  check mirrors the server action so bad input never leaves the dialog, same
   *  reasoning as ExchangeRatesView's Save All validation. */
  existingNames: string[];
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: (input: AccountInput) => void;
  onCancel: () => void;
}) {
  const [accountName, setAccountName] = useState(initial?.account_name ?? "");
  const [accountType, setAccountType] = useState<string>(initial?.account_type ?? ACCOUNT_TYPES[0]);
  const [currency, setCurrency] = useState(initial?.currency ?? "SGD");
  // Postgres/PostgREST actually returns opening_balance as a JSON number despite the
  // Account domain type declaring it `string` (verified: {"opening_balance":250.50} over
  // the wire, no quotes) — String() here guarantees this stays a real string regardless
  // of which shape arrives, since every downstream use (.trim(), controlled <input>) requires one.
  const [openingBalance, setOpeningBalance] = useState(String(initial?.opening_balance ?? "0"));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [touched, setTouched] = useState(false);

  const trimmedName = accountName.trim();
  const nameError = trimmedName === "" ? "Account name is required." : null;
  const duplicateError =
    !nameError && existingNames.some((n) => n.trim().toLowerCase() === trimmedName.toLowerCase())
      ? `An account named "${trimmedName}" already exists.`
      : null;
  const balanceError =
    openingBalance.trim() === "" || Number.isNaN(Number(openingBalance)) ? "Opening balance must be a number." : null;

  function handleSubmit() {
    setTouched(true);
    if (nameError || duplicateError || balanceError) return;
    onSubmit({ accountName: trimmedName, accountType, currency, openingBalance, notes });
  }

  return (
    <div className="mt-3 space-y-3">
      <div>
        <label className={labelClass}>Account name</label>
        <input className={inputClass} value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="e.g. POSB Bank" />
        {touched && (nameError || duplicateError) && (
          <p className="mt-1 text-[11px] font-semibold text-destructive">{nameError || duplicateError}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Account type</label>
          <select className={inputClass} value={accountType} onChange={(e) => setAccountType(e.target.value)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {accountTypeLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Currency</label>
          <select className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {ALL_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass}>Opening balance</label>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          className={inputClass}
          value={openingBalance}
          onChange={(e) => setOpeningBalance(e.target.value)}
          placeholder="0.00"
        />
        {touched && balanceError && <p className="mt-1 text-[11px] font-semibold text-destructive">{balanceError}</p>}
      </div>

      <div>
        <label className={labelClass}>Notes</label>
        <textarea
          className={cn(inputClass, "resize-none")}
          rows={2}
          value={notes ?? ""}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
        />
      </div>

      {error && <p className="text-[12px] font-semibold text-destructive">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={pending}
          onClick={handleSubmit}
          className="flex-1 rounded-lg bg-primary py-2 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="flex-1 rounded-lg border border-border py-2 text-[13px] font-semibold disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
