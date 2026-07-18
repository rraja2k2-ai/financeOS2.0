/**
 * Spot-checks that migrations 002-005 landed correctly in Supabase. Read-only.
 * Run: npm run db:verify:migrations
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

if (!url || !anonKey) {
  console.error("[FinanceOS] Missing Supabase env vars. Run: npm run db:verify:migrations");
  process.exit(1);
}

const supabase = createClient(url, anonKey);
let anyFail = false;

function report(label, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) anyFail = true;
}

console.log("=== 002: categorization_rules dedup + retaxonomy ===");
{
  const { data, error } = await supabase.from("categorization_rules").select("merchant_pattern, primary_category, secondary_category");
  if (error) { report("query categorization_rules", false, error.message); }
  else {
    const counts = {};
    for (const r of data) counts[r.merchant_pattern] = (counts[r.merchant_pattern] || 0) + 1;
    const dupes = Object.entries(counts).filter(([, n]) => n > 1);
    report("no duplicate merchant_pattern rows", dupes.length === 0, dupes.length ? `${dupes.length} dupes, e.g. ${dupes[0][0]}` : `${data.length} total rows`);
    const oldTaxonomy = data.filter((r) => ["Food", "Bills", "Transport", "Health"].includes(r.primary_category));
    report("no old coarse taxonomy values (Food/Bills/Transport/Health)", oldTaxonomy.length === 0, oldTaxonomy.length ? `${oldTaxonomy.length} rows still old, e.g. ${oldTaxonomy[0].merchant_pattern}` : "");
  }
}

console.log("\n=== 003+004: budgets consolidated into project_budgets ===");
{
  const { data: pb, error: pbErr } = await supabase
    .from("project_budgets")
    .select("id, budget_month, category_type, primary_category, secondary_category, projects(project_name)");
  if (pbErr) { report("query project_budgets", false, pbErr.message); }
  else {
    report("project_budgets has budget_month/category_type populated", pb.every((r) => r.budget_month && r.category_type), `${pb.length} total rows`);
    const generic = pb.filter((r) => r.projects?.project_name === "Generic");
    report("Generic project has budget rows (expect ~41 for migrated month)", generic.length > 0, `${generic.length} rows`);
  }

  const { error: legacyErr } = await supabase.from("budgets_legacy").select("id").limit(1);
  report("old budgets table renamed to budgets_legacy", !legacyErr, legacyErr?.message);

  const { error: oldTableErr } = await supabase.from("budgets").select("id").limit(1);
  report("old `budgets` table no longer queryable directly", !!oldTableErr, oldTableErr ? "correctly gone" : "still exists — rename may not have run");
}

console.log("\n=== 005: atomic save RPC + qty column type ===");
{
  const { error: rpcErr } = await supabase.rpc("save_transaction", { header: null, items: null, attachment: null });
  // We expect *some* error (null header should fail inside the function) — what matters
  // is it's NOT a "function does not exist" error (PGRST202 / 42883 / PostgREST's
  // "Could not find the function ... in the schema cache").
  const missingFn = rpcErr && /does not exist|PGRST202|could not find the function/i.test(rpcErr.message ?? "");
  report("save_transaction RPC exists", !missingFn, rpcErr ? rpcErr.message : "callable");

  const { data: items, error: itemsErr } = await supabase.from("transaction_items").select("qty").limit(1);
  if (itemsErr) { report("query transaction_items", false, itemsErr.message); }
  else if (items.length) { report("transaction_items.qty is readable", true, `sample: "${items[0].qty}"`); }
  else { report("transaction_items.qty is readable", true, "(no rows to sample)"); }
}

console.log(anyFail ? "\nSome checks FAILED — see above." : "\nAll migration checks passed.");
process.exit(anyFail ? 1 : 0);
