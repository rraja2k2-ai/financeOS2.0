import Link from "next/link";

const SETTINGS_ITEMS = [
  { href: "/settings/appearance", label: "Appearance", description: "System, Dark, or Light theme" },
  { href: "/settings/general", label: "General", description: "Base currency" },
  { href: "/settings/exchange-rates", label: "Exchange Rates", description: "Manage conversion rates" },
  { href: "/settings/categories", label: "Categories", description: "Categorization taxonomy" },
  { href: "/settings/accounts", label: "Accounts", description: "Your linked accounts" },
  { href: "/settings/ai", label: "AI", description: "Open the Capture Inbox" },
  { href: "/settings/data-management", label: "Data Management", description: "Export, reports, import" },
  { href: "/settings/about", label: "About", description: "App information" },
];

export default function SettingsPage() {
  return (
    <div className="px-5 pt-6 pb-8">
      <h1 className="mb-4 text-[22px] font-bold tracking-tight">Settings</h1>

      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
        {SETTINGS_ITEMS.map((item, i) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center justify-between p-4 ${i > 0 ? "border-t border-border" : ""}`}
          >
            <div>
              <p className="text-[14px] font-semibold">{item.label}</p>
              <p className="text-[12px] text-muted-foreground">{item.description}</p>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Link>
        ))}
      </div>
    </div>
  );
}
