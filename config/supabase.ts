import { validateSupabaseEnv } from "@/config/env";

export type SupabaseConfig = {
  url: string;
  anonKey: string;
};

export function getSupabaseConfig(): SupabaseConfig {
  return validateSupabaseEnv();
}
