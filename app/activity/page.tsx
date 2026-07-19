import { createServerSupabaseClient } from "@/lib/supabase";
import { getActivity } from "@/services/finance/activity.service";
import { loadCaptureMasterData } from "@/services/capture/master-data.service";
import { ActivityView } from "@/components/activity/ActivityView";
import { todayIso } from "@/lib/period";

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
  searchParams: Promise<{ highlight?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  // masterData powers the (single, reused) Review screen's dropdowns when editing a
  // transaction from Activity — loaded once here, no client-side queries.
  const [transactions, masterData] = await Promise.all([
    getActivity(supabase, twelveMonthsAgoIso(), todayIso()),
    loadCaptureMasterData(supabase),
  ]);
  const { highlight } = await searchParams;

  return <ActivityView transactions={transactions} highlightId={highlight} masterData={masterData} />;
}
