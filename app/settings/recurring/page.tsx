import { createServerSupabaseClient } from "@/lib/supabase";
import { recurringRuleRepository, accountRepository, projectRepository } from "@/repositories";
import { loadCaptureMasterData } from "@/services/capture/master-data.service";
import { RecurringView } from "@/components/recurring/RecurringView";

export default async function RecurringPage() {
  const supabase = await createServerSupabaseClient();
  const [rules, accounts, projects, masterData] = await Promise.all([
    recurringRuleRepository.list(supabase),
    accountRepository.list(supabase),
    projectRepository.list(supabase),
    loadCaptureMasterData(supabase),
  ]);

  const accountsById = Object.fromEntries(accounts.map((a) => [a.id, a.account_name]));
  const projectsById = Object.fromEntries(projects.map((p) => [p.id, p.project_name]));

  return <RecurringView rules={rules} masterData={masterData} accountsById={accountsById} projectsById={projectsById} />;
}
