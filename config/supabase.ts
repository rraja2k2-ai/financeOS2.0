import { validateSupabaseEnv } from "@/config/environment";

export type SupabaseConfig = {
  url: string;
  anonKey: string;
};

export function getSupabaseConfig(): SupabaseConfig {
  return validateSupabaseEnv();
}
