import { createServerSupabaseClient } from "@/lib/supabase";
import { getActivity } from "@/services/finance/activity.service";
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
  const transactions = await getActivity(supabase, twelveMonthsAgoIso(), todayIso());
  const { highlight } = await searchParams;

  return <ActivityView transactions={transactions} highlightId={highlight} />;
}
