export type Project = {
  id: string;
  project_name: string;
  start_date: string | null;
  end_date: string | null;
  project_currency: string | null;
  project_budget: string | null;
  project_budget_sgd: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};
