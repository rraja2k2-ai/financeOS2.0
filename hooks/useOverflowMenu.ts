"use client";

import { useCallback, useEffect, useState } from "react";

export type OverflowMenuAnchor = { id: string; rect: DOMRect };

/**
 * Shared behavior for every portal-rendered "⋮" overflow menu in FinanceOS (Activity,
 * Dashboard Recent Transactions, Account Detail, Settings Accounts) — previously each
 * screen copy-pasted its own `useState<{id,rect}|null>` + scroll/resize-close effect
 * (Transaction UX Final Polish milestone, Part 4). Centralizes the three ways a menu
 * must close: pressing Escape, clicking anywhere outside it, or opening a different
 * menu (toggle already handles that — opening a new anchor replaces the old one).
 *
 * Scroll/resize-close is kept (a floating, position-computed menu goes stale under the
 * trigger otherwise) alongside the new Escape/click-outside handling, not duplicated.
 */
export function useOverflowMenu() {
  const [anchor, setAnchor] = useState<OverflowMenuAnchor | null>(null);

  const close = useCallback(() => setAnchor(null), []);

  const toggle = useCallback((id: string, rect: DOMRect) => {
    setAnchor((current) => (current?.id === id ? null : { id, rect }));
  }, []);

  useEffect(() => {
    if (!anchor) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setAnchor(null);
    }
    // Click-outside: the menu itself stops propagation on its own click handler (every
    // call site already does this), so any click that reaches document here is, by
    // definition, outside the menu.
    function onDocumentClick() {
      setAnchor(null);
    }
    function onScrollOrResize() {
      setAnchor(null);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onDocumentClick);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onDocumentClick);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [anchor]);

  return { anchor, toggle, close };
}
