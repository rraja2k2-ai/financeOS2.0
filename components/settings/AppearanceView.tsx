"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { DEFAULT_THEME, getStoredTheme, setTheme, type ThemeMode } from "@/lib/theme";

const OPTIONS: { mode: ThemeMode; label: string; description: string }[] = [
  { mode: "system", label: "System", description: "Follows your device's setting" },
  { mode: "dark", label: "Dark", description: "FinanceOS's default" },
  { mode: "light", label: "Light", description: "Always light" },
];

export function AppearanceView() {
  // Server-rendered initial value must match the pre-paint <head> script's default
  // (dark) to avoid a hydration mismatch; the real stored value is read right after
  // mount, same pattern as the pre-paint script itself.
  const [current, setCurrent] = useState<ThemeMode>(DEFAULT_THEME);

  useEffect(() => {
    setCurrent(getStoredTheme());
  }, []);

  function handleSelect(mode: ThemeMode) {
    if (mode === current) return;
    setCurrent(mode);
    setTheme(mode);
  }

  return (
    <div className="px-5 pt-6 pb-8">
      <SettingsPageHeader title="Appearance" />

      <section>
        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Theme</p>
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          {OPTIONS.map((option, i) => (
            <button
              key={option.mode}
              type="button"
              onClick={() => handleSelect(option.mode)}
              className={cn("flex w-full items-center justify-between p-4 text-left", i > 0 && "border-t border-border")}
            >
              <div>
                <span className="text-[14px] font-semibold">{option.label}</span>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">{option.description}</p>
              </div>
              {current === option.mode && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-primary">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
          Applies immediately across the whole app and is remembered on this device — web, mobile browser, or
          installed to your home screen.
        </p>
      </section>
    </div>
  );
}
