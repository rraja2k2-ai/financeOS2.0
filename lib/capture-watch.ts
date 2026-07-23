/**
 * Same-tab coordination between the Capture Modal (owns detecting its own capture
 * finishing while it's open — CaptureModal.tsx) and InboxIndicator's fallback poll (only
 * meant to act on a row whenever no Modal is open to see it — CLAUDE.md §7). Without
 * this, InboxIndicator's independent polling interval could race the Modal's own poll: if
 * the Indicator read a row's `transactionHeaderId` first, it would consume (delete) the
 * row for cleanup before the Modal's own poll ever saw it, so the Modal would then find
 * the row gone and close silently instead of showing its success card.
 */
const watchedQueueIds = new Set<string>();

export function watchQueueId(id: string): void {
  watchedQueueIds.add(id);
}

export function unwatchQueueId(id: string): void {
  watchedQueueIds.delete(id);
}

export function isQueueIdWatched(id: string): boolean {
  return watchedQueueIds.has(id);
}
