import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { deleteQueueItem } from "@/services/capture/inbox.service";

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
