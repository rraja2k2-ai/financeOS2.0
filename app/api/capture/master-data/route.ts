import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { loadCaptureMasterData } from "@/services/capture/master-data.service";

/**
 * Read-only master data for the Capture success screen's "Review Transaction" action.
 * The Capture Modal is mounted globally (outside any page that already loads master
 * data server-side), so it needs its own fetch to populate the SAME shared ReviewScreen's
 * dropdowns — reuses loadCaptureMasterData unmodified, no new business logic. Fetched
 * lazily, only when the user actually clicks Review Transaction, not on every capture.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const masterData = await loadCaptureMasterData(supabase);
    return NextResponse.json({ masterData });
  } catch (err) {
    console.error("[capture/master-data] GET failed:", err);
    return NextResponse.json({ error: "Couldn't load data for the Review screen. Try again." }, { status: 500 });
  }
}
