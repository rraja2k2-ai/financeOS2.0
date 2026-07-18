import Link from "next/link";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import type { Account } from "@/domain/account";

export function SettingsAccountsView({ accounts }: { accounts: Account[] }) {
  return (
    <div className="px-5 pt-6 pb-8">
      <SettingsPageHeader title="Accounts" />

      {accounts.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
          No accounts yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          {accounts.map((account, i) => (
            <div key={account.id} className={`flex items-center justify-between p-4 ${i > 0 ? "border-t border-border" : ""}`}>
              <div>
                <p className="text-[14px] font-semibold">{account.account_name}</p>
                <p className="text-[12px] text-muted-foreground">
                  {account.account_type} · {account.currency} · {account.status}
                </p>
              </div>
              <p className="font-mono text-[13px] font-semibold tabular-nums">
                {account.currency} {Number(account.current_balance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          ))}
        </div>
      )}

      <Link
        href="/accounts"
        className="mt-4 block rounded-[var(--radius-md)] border border-border bg-card p-3.5 text-center text-[13px] font-semibold text-primary"
      >
        Manage accounts →
      </Link>
    </div>
  );
}
