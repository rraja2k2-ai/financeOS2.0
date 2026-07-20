/**
 * Theme preference — System / Dark / Light, consistent across web, mobile browser, and
 * PWA (Settings → Appearance). A single localStorage key is the source of truth; there
 * is no server/DB persistence because this is a per-device rendering preference, not
 * application data (see CLAUDE.md §7). The project default is Dark when nothing has
 * been chosen yet — deliberately not "System", per product decision.
 *
 * The pre-paint script in app/layout.tsx duplicates this module's key/default/logic as
 * plain strings (a <head> script can't import a module) — keep the two in sync if
 * either changes.
 */

export type ThemeMode = "system" | "dark" | "light";

export const THEME_STORAGE_KEY = "financeos-theme";
export const DEFAULT_THEME: ThemeMode = "dark";

const DARK_THEME_COLOR = "#0b0f14";
const LIGHT_THEME_COLOR = "#f7f8fa";

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "dark" || value === "light";
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function getStoredTheme(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeMode(stored) ? stored : DEFAULT_THEME;
}

export function resolvesToDark(mode: ThemeMode): boolean {
  return mode === "dark" || (mode === "system" && systemPrefersDark());
}

/** Applies the resolved theme to <html>.dark and keeps the theme-color meta tag (mobile browser chrome / PWA) in sync. */
export function applyTheme(mode: ThemeMode): void {
  const isDark = resolvesToDark(mode);
  document.documentElement.classList.toggle("dark", isDark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", isDark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
}

export function setTheme(mode: ThemeMode): void {
  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  applyTheme(mode);
}
