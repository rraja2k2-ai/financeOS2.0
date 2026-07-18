export type ProjectStatus = "Active" | "Inactive";
// These exact strings are enforced by the DB check constraint chk_budget_type.
export type BudgetType = "Fixed" | "Track Only";

export const GENERIC_PROJECT_NAME = "Generic";

export type Project = {
  id: string;
  project_name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  budget_type: string | null;
  budget_currency: string | null;
  budget_amount: string | null;
  // Legacy budget columns kept for backwards compatibility (superseded by budget_* above).
  project_currency: string | null;
  project_budget: string | null;
  project_budget_sgd: string | null;
  created_at: string;
  updated_at: string;
};

/** Generic is a system project: it can't be renamed, deleted, or marked Inactive. */
export function isGenericProject(project: Pick<Project, "project_name">): boolean {
  return project.project_name === GENERIC_PROJECT_NAME;
}
