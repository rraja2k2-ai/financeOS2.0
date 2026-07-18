/**
 * Receipt ID generation (TAD-004 §3 Transaction Services; TAD-003 §11.2).
 * Server-only, deterministic — AI never generates this (TAD-005 §4). Pattern:
 * REC_YYYYMMDD_HHMMSS_nnn, where nnn is a 3-digit random suffix to keep IDs generated
 * within the same second unique without a database round-trip.
 */
export function generateReceiptId(now: Date = new Date()): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");

  const y = now.getFullYear();
  const mo = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  const suffix = pad(Math.floor(Math.random() * 1000), 3);

  return `REC_${y}${mo}${d}_${h}${mi}${s}_${suffix}`;
}
