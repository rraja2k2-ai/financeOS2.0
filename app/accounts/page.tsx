import { createServerSupabaseClient } from "@/lib/supabase";
import { accountRepository } from "@/repositories";
import { getGroupedAccounts } from "@/services/finance/accounts.service";
import { AccountsView } from "@/components/accounts/AccountsView";

export default async function AccountsPage() {
  const supabase = await createServerSupabaseClient();
  const accounts = await accountRepository.list(supabase);
  const data = await getGroupedAccounts(supabase, accounts);

  return <AccountsView data={data} />;
}
