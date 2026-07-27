import type { ReactNode } from "react";
import Link from "next/link";

/** `action` is optional and renders right-aligned — every existing settings page omits
 *  it and renders exactly as before (Accounts is the first to use it, for "Add Account"). */
export function SettingsPageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Link
          href="/settings"
          aria-label="Back to Settings"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="text-[19px] font-bold tracking-tight">{title}</h1>
      </div>
      {action}
    </div>
  );
}
