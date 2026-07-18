import { NextRequest, NextResponse, after } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { retryQueueItem, processQueueItem } from "@/services/capture/inbox.service";

export const maxDuration = 60;

/**
 * Retries a Failed capture: flips it back to Processing and reruns the pipeline in the
 * background, reusing the ORIGINAL stored receipt pages + context — the user never has
 * to upload anything again.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const supabase = await createServerSupabaseClient();
    await retryQueueItem(supabase, id);

    after(() => processQueueItem(id));

    return NextResponse.json({ retried: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't retry this capture.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
