import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { transactionHeaderRepository } from "@/repositories";

/**
 * Post-capture navigation (UX improvement) — lets the client find "the transaction a
 * just-finished background capture became" without capture_queue keeping any trace of
 * it (the row is deleted immediately on success, per CLAUDE.md §5). Read-only, single
 * row, ordered by capture time — see transaction-header.repository.ts's getLatest.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const header = await transactionHeaderRepository.getLatest(supabase);
    return NextResponse.json({ id: header?.id ?? null });
  } catch (err) {
    console.error("[transactions/latest] GET failed:", err);
    return NextResponse.json({ id: null });
  }
}
