import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { deleteQueueItem, getInboxItemStatus } from "@/services/capture/inbox.service";

/**
 * Polled by the Capture screen (Fix 6.4A) while a just-submitted receipt is still
 * processing — the screen stays open asking "is this one done yet?" instead of closing
 * blind right after upload. `item.transactionHeaderId` set means Save succeeded with that
 * EXACT id (Fix 6.4.4 — never a "latest transaction" guess); `item: null` means the row
 * was already consumed (e.g. by the global Inbox indicator, if this Modal wasn't first).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const supabase = await createServerSupabaseClient();
    const item = await getInboxItemStatus(supabase, id);
    return NextResponse.json({ item });
  } catch (err) {
    console.error("[inbox] status check failed:", err);
    return NextResponse.json({ error: "Couldn't check capture status." }, { status: 500 });
  }
}

/**
 * Deletes a queued capture's row (and its Storage files, unless already Saved — those
 * files now belong to the saved transaction's receipt_attachments). Never deletes a
 * transaction. Allowed in any state; the "linked to a transaction" confirmation is a
 * client-side (Inbox UI) concern.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const supabase = await createServerSupabaseClient();
    await deleteQueueItem(supabase, id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("[inbox] delete failed:", err);
    return NextResponse.json({ error: "Couldn't delete this capture. Try again." }, { status: 500 });
  }
}
