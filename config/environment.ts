const SUPABASE_ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

export type SupabaseEnvVar = (typeof SUPABASE_ENV_VARS)[number];

export function getEnv(name: SupabaseEnvVar): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `[FinanceOS] Missing required environment variable "${name}". ` +
        `Copy .env.example to .env.local and add your Supabase credentials.`
    );
  }

  return value;
}

export function validateSupabaseEnv(): { url: string; anonKey: string } {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  try {
    new URL(url);
  } catch {
    throw new Error(
      `[FinanceOS] NEXT_PUBLIC_SUPABASE_URL is not a valid URL: "${url}". ` +
        `Use the Project URL from your Supabase dashboard.`
    );
  }

  if (anonKey.length < 20) {
    throw new Error(
      `[FinanceOS] NEXT_PUBLIC_SUPABASE_ANON_KEY appears invalid. ` +
        `Use the anon public key from your Supabase dashboard.`
    );
  }

  return { url, anonKey };
}
