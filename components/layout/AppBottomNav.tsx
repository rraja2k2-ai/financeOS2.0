"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { CaptureLauncher } from "@/components/capture/CaptureLauncher";
import { InboxIndicator } from "@/components/capture/InboxIndicator";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Dashboard",
    icon: (
      <path d="M3 12 12 4l9 8M5 10v10h5v-6h4v6h5V10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    href: "/activity",
    label: "Activity",
    icon: <path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  },
  {
    href: "/accounts",
    label: "Accounts",
    icon: (
      <>
        <rect x="2" y="7" width="20" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M2 10h20M6 15h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M7 7V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" fill="none" stroke="currentColor" strokeWidth="2" />
      </>
    ),
  },
  {
    href: "/budget",
    label: "Budget",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M7 2v4M17 2v4M3 10h18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: "/projects",
    label: "Projects",
    icon: (
      <>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </>
    ),
  },
  {
    href: "/invest",
    label: "Invest",
    icon: <path d="M3 3v18h18M19 9l-5 5-4-4-4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M3 10h18M7 6V4h10v2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
];

export function AppBottomNav() {
  const pathname = usePathname();

  return (
    <>
      {/* "+" FAB + Capture modal (async enqueue) — Review/Save live in the Capture Inbox. */}
      <CaptureLauncher />

      {/* Global Capture Inbox indicator — visible everywhere, hidden when the queue is empty. */}
      <InboxIndicator />

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex h-[78px] items-stretch border-t border-border bg-card/95 px-1 backdrop-blur-md"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label="Primary"
      >
        {NAV_ITEMS.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 pt-2 text-[10.5px] font-semibold",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                {item.icon}
              </svg>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
