import { createServerSupabaseClient } from "@/lib/supabase";
import { getActivityWithHighlight } from "@/services/finance/activity.service";
import { loadCaptureMasterData } from "@/services/capture/master-data.service";
import { ActivityView } from "@/components/activity/ActivityView";
import { todayIso } from "@/lib/period";

// Auto-save (UX refresh Phase F) can insert a new transaction here from a background
// job, outside any request Activity itself is part of — same reasoning as Inbox's own
// dynamic export: never serve a cached render.
export const dynamic = "force-dynamic";

// One upfront fetch, then period/search/group filtering happens client-side (see
// ActivityView) — 12 months gives the "Custom date" range meaningful room without
// needing a server round-trip per date change.
function twelveMonthsAgoIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 366);
  return d.toISOString().slice(0, 10);
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ highlight?: string; edit?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const { highlight, edit } = await searchParams;
  // masterData powers the (single, reused) Review screen's dropdowns when editing a
  // transaction from Activity — loaded once here, no client-side queries. Uses
  // getActivityWithHighlight (Fix 7.0) so a ?highlight=<id> deep link — most importantly
  // the one post-capture navigation uses — always finds its target regardless of the
  // transaction's own date, never silently missing it because it falls outside the
  // default rolling window.
  const [transactions, masterData] = await Promise.all([
    getActivityWithHighlight(supabase, twelveMonthsAgoIso(), todayIso(), highlight),
    loadCaptureMasterData(supabase),
  ]);

  return <ActivityView transactions={transactions} highlightId={highlight} autoEdit={edit === "1"} masterData={masterData} />;
}
