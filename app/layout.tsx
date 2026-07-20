import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppBottomNav } from "@/components/layout/AppBottomNav";
import { ThemeSync } from "@/components/layout/ThemeSync";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FinanceOS",
  description: "AI-first personal finance application",
};

// Matches DEFAULT_THEME ("dark") in lib/theme.ts — the initial paint before any script
// runs. Kept in sync afterward (including the user's actual choice) by that module.
export const viewport: Viewport = {
  themeColor: "#0b0f14",
};

// Applies the theme preference (Settings → Appearance) before paint, so there's never a
// flash of the wrong theme. Duplicates lib/theme.ts's key/default/resolution logic as
// plain strings — a <head> script can't import a module — keep the two in sync.
const THEME_SYNC_SCRIPT = `
  (function () {
    try {
      var stored = window.localStorage.getItem('financeos-theme');
      var mode = (stored === 'system' || stored === 'dark' || stored === 'light') ? stored : 'dark';
      var isDark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (isDark) document.documentElement.classList.add('dark');
    } catch (e) {}
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SYNC_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-background text-foreground antialiased`}
      >
        <ThemeSync />
        <div className="mx-auto min-h-screen max-w-[480px] pb-[96px]">
          {children}
        </div>
        <AppBottomNav />
      </body>
    </html>
  );
}
