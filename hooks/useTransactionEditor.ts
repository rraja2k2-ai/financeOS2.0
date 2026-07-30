"use client";

import { useCallback, useState } from "react";
import type { CaptureMasterData, CaptureReceiptResult } from "@/services/ai/ai-provider";
import type { ReviewedCapture } from "@/services/capture/save-capture.service";
import type { RecentTransaction } from "@/services/finance/activity.service";

/** An existing transaction opened for editing — fetched on demand, shaped for the SAME
 *  ReviewScreen used by Capture. Identical shape to what Activity/Dashboard previously
 *  each defined locally. */
export type EditingTransaction = {
  headerId: string;
  result: CaptureReceiptResult;
  itemIds: string[];
  capturedAt: string;
};

type UseTransactionEditorOptions = {
  /** Master data already available (e.g. Activity's page loads it server-side) — when
   *  provided, opening the editor never fetches it. Omit to lazy-fetch on first open
   *  (Dashboard, Account Detail), matching each entry point's existing behavior. */
  masterData?: CaptureMasterData | null;
  /** Called after a successful save with the PUT response's recentTransaction field, so
   *  each host keeps its own existing post-save behavior (Activity toasts + refreshes
   *  the router, Dashboard patches one card in place) instead of this hook forcing a
   *  single strategy on every caller. */
  onSaved?: (recentTransaction: RecentTransaction | null) => void;
  /** Called after a successful delete (Transaction Workspace Foundation) with the deleted
   *  transaction's id, so a host that keeps a local list (Dashboard) can remove just that
   *  row instead of this hook forcing a single strategy on every caller. */
  onDeleted?: (headerId: string) => void;
  /** Called whenever a fetch/save/delete fails, so each host keeps its own existing error banner. */
  onError?: (message: string) => void;
};

/**
 * Shared orchestration for opening the one Review/Edit screen used everywhere in
 * FinanceOS (Transaction Workspace Foundation) — fetch master data (lazily, unless
 * already provided), fetch the transaction reshaped for ReviewScreen, save edits back
 * (UPDATE, never a new transaction), and delete. Previously this exact sequence was
 * copy-pasted between ActivityView.tsx and DashboardView.tsx; this hook is the one
 * place it lives now, reused by Capture, Dashboard, Activity, and Account Detail.
 */
export function useTransactionEditor(options: UseTransactionEditorOptions = {}) {
  const { masterData: providedMasterData, onSaved, onDeleted, onError } = options;
  const [masterData, setMasterData] = useState<CaptureMasterData | null>(providedMasterData ?? null);
  const [editing, setEditing] = useState<EditingTransaction | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const openEditor = useCallback(
    async (txnId: string) => {
      setLoadingId(txnId);
      try {
        let data = providedMasterData ?? masterData;
        if (!data) {
          const mdRes = await fetch("/api/capture/master-data");
          const mdBody = (await mdRes.json().catch(() => null)) as { masterData?: CaptureMasterData; error?: string } | null;
          if (!mdRes.ok || !mdBody?.masterData) {
            onError?.(mdBody?.error ?? "Couldn't load data for the Review screen. Try again.");
            return;
          }
          data = mdBody.masterData;
          setMasterData(data);
        }

        const res = await fetch(`/api/transactions/${txnId}`);
        const body = (await res.json().catch(() => null)) as
          | { result?: CaptureReceiptResult; itemIds?: string[]; capturedAt?: string; error?: string }
          | null;
        if (!res.ok || !body?.result || !body?.itemIds) {
          onError?.(body?.error ?? "Couldn't load this transaction. Try again.");
          return;
        }
        setEditing({ headerId: txnId, result: body.result, itemIds: body.itemIds, capturedAt: body.capturedAt ?? "" });
      } catch {
        onError?.("Couldn't reach the server. Try again.");
      } finally {
        setLoadingId(null);
      }
    },
    [providedMasterData, masterData, onError]
  );

  const closeEditor = useCallback(() => setEditing(null), []);

  const saveEditor = useCallback(
    // itemIds is the SURVIVING subset ReviewScreen hands back (Individual Line Item
    // Deletion Bug Fix) — never editing.itemIds directly, which stays the original,
    // pre-edit full list for as long as `editing` is set and would re-introduce the
    // "Line items changed unexpectedly" bug for any save that deleted an item.
    async (reviewed: ReviewedCapture, itemIds: string[]) => {
      if (!editing) return;
      const res = await fetch(`/api/transactions/${editing.headerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewed, itemIds }),
        signal: AbortSignal.timeout(60_000),
      }).catch(() => null);

      const body = res
        ? ((await res.json().catch(() => null)) as { updated?: boolean; recentTransaction?: RecentTransaction | null; error?: string } | null)
        : null;
      if (!res || !res.ok || !body?.updated) {
        throw new Error(body?.error ?? "Couldn't save changes. Your edits are safe — please try again.");
      }

      setEditing(null);
      onSaved?.(body.recentTransaction ?? null);
    },
    [editing, onSaved]
  );

  const deleteEditor = useCallback(async () => {
    if (!editing) return;
    const headerId = editing.headerId;
    const res = await fetch(`/api/transactions/${headerId}`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) {
      const body = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
      throw new Error(body?.error ?? "Couldn't delete this transaction. Try again.");
    }
    setEditing(null);
    onDeleted?.(headerId);
  }, [editing, onDeleted]);

  return { masterData, editing, loadingId, openEditor, closeEditor, saveEditor, deleteEditor };
}
