"use client";

import { useEffect } from "react";
import { applyTheme, getStoredTheme, THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Mounted once in the root layout (present on every page) so theme changes apply
 * everywhere immediately, not just on the Settings screen that made them:
 *   - "System" mode tracks the OS live — if the user flips their OS theme while
 *     FinanceOS is open, this re-resolves without a reload.
 *   - A theme change made in another browser tab (the `storage` event only fires in
 *     OTHER tabs, never the one that wrote it) is picked up here too, so every open
 *     tab/window stays consistent, not just the one the user touched.
 * Renders nothing — the actual pre-paint theme application happens in the inline
 * <head> script in app/layout.tsx; this only keeps it correct after mount.
 */
export function ThemeSync() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    function reapply() {
      applyTheme(getStoredTheme());
    }

    function onStorage(e: StorageEvent) {
      if (e.key === THEME_STORAGE_KEY) reapply();
    }

    media.addEventListener("change", reapply);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", reapply);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}
