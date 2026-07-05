import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "@/config/supabase";

export function createClient() {
  const { url, anonKey } = getSupabaseConfig();

  return createBrowserClient(url, anonKey);
}
