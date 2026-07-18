import Link from "next/link";

export function SettingsPageHeader({ title }: { title: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
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
  );
}
