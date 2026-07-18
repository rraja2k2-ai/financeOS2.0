import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppBottomNav } from "@/components/layout/AppBottomNav";

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

// Syncs the `.dark` class (which globals.css keys off) with the OS preference before
// paint, since there's no theme toggle yet — avoids a flash of the wrong theme.
const THEME_SYNC_SCRIPT = `
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('dark');
  }
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
        <div className="mx-auto min-h-screen max-w-[480px] pb-[96px]">
          {children}
        </div>
        <AppBottomNav />
      </body>
    </html>
  );
}
