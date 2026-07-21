import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { consumeSavedCapture } from "@/services/capture/inbox.service";

/**
 * Called by whichever client (the Capture Modal or the global Inbox indicator, Fix 6.4.4)
 * first reads a saved row's transaction_header_id — clears the now-finished queue row.
 * Metadata-only: never touches Storage or transaction_headers/transaction_items. Safe to
 * call more than once (e.g. a race between the two pollers) — a missing row is a no-op.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const supabase = await createServerSupabaseClient();
    await consumeSavedCapture(supabase, id);
    return NextResponse.json({ consumed: true });
  } catch (err) {
    console.error("[inbox] consume failed:", err);
    return NextResponse.json({ error: "Couldn't finalize this capture." }, { status: 500 });
  }
}
