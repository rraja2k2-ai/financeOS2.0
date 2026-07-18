import { createServerSupabaseClient } from "@/lib/supabase";
import { accountRepository } from "@/repositories";
import { SettingsAccountsView } from "@/components/settings/SettingsAccountsView";

export default async function AccountsSettingsPage() {
  const supabase = await createServerSupabaseClient();
  const accounts = await accountRepository.list(supabase);

  return <SettingsAccountsView accounts={accounts} />;
}
