import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

if (!url || !anonKey) {
  console.error(
    "[FinanceOS] Missing Supabase environment variables.\n" +
      "Copy .env.example to .env.local and add your credentials.\n" +
      "Run: npm run db:verify -- --env-file=.env.local"
  );
  process.exit(1);
}

const supabase = createClient(url, anonKey);

const response = await fetch(`${url}/rest/v1/`, {
  headers: {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
  },
});

if (!response.ok) {
  console.error(
    `[FinanceOS] Supabase connection failed (${response.status} ${response.statusText}).`
  );
  console.error(
    "Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
  );
  process.exit(1);
}

const { error: authError } = await supabase.auth.getSession();

if (authError) {
  console.error("[FinanceOS] Supabase auth endpoint error:", authError.message);
  process.exit(1);
}

console.log("[FinanceOS] Supabase connection verified successfully.");
console.log(`  URL: ${url}`);
