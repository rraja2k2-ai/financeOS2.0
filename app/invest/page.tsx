import { createServerSupabaseClient } from "@/lib/supabase";
import { accountRepository } from "@/repositories";
import { getInvestmentPortfolioSummary } from "@/services/finance/investment-portfolio.service";
import { InvestmentPortfolioView } from "@/components/investments/InvestmentPortfolioView";

export default async function InvestmentPortfolioPage() {
  const supabase = await createServerSupabaseClient();
  const accounts = await accountRepository.list(supabase);
  const summary = await getInvestmentPortfolioSummary(supabase, accounts);

  return <InvestmentPortfolioView summary={summary} />;
}
