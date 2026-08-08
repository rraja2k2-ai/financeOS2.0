import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectBudget } from "@/domain/project-budget";

export async function getById(supabase: SupabaseClient, id: string): Promise<ProjectBudget | null> {
  const { data, error } = await supabase
    .from("project_budgets")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function list(supabase: SupabaseClient): Promise<ProjectBudget[]> {
  const { data, error } = await supabase.from("project_budgets").select("*");

  if (error) {
    throw error;
  }

  return data || [];
}

/** All MONTHLY budget lines for one project in one real month. `month` must be
 *  first-of-month, e.g. "2026-07-01". */
export async function listByProjectMonth(
  supabase: SupabaseClient,
  projectId: string,
  month: string
): Promise<ProjectBudget[]> {
  const { data, error } = await supabase
    .from("project_budgets")
    .select("*")
    .eq("project_id", projectId)
    .eq("row_type", "MONTHLY")
    .eq("budget_month", month)
    .order("primary_category", { ascending: true })
    .order("secondary_category", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

/** All MONTHLY budget lines across every project for one real month (for the Budget
 *  screen's "By category" roll-up). */
export async function listByMonth(supabase: SupabaseClient, month: string): Promise<ProjectBudget[]> {
  const { data, error } = await supabase.from("project_budgets").select("*").eq("row_type", "MONTHLY").eq("budget_month", month);

  if (error) {
    throw error;
  }

  return data || [];
}

/** All LIFETIME budget lines for one project (named projects' non-monthly envelopes). */
export async function listLifetimeByProject(supabase: SupabaseClient, projectId: string): Promise<ProjectBudget[]> {
  const { data, error } = await supabase
    .from("project_budgets")
    .select("*")
    .eq("project_id", projectId)
    .eq("row_type", "LIFETIME")
    .order("primary_category", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

/** Whether this project has ANY LIFETIME budget line — used to block permanent project
 *  deletion (Project Management Service's delete guard), without fetching full rows just
 *  to check for at least one. */
export async function existsLifetimeForProject(supabase: SupabaseClient, projectId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("project_budgets")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("row_type", "LIFETIME");

  if (error) {
    throw error;
  }

  return (count ?? 0) > 0;
}

/** All LIFETIME budget lines across every project (for the Projects list page's summary pass). */
export async function listLifetime(supabase: SupabaseClient): Promise<ProjectBudget[]> {
  const { data, error } = await supabase.from("project_budgets").select("*").eq("row_type", "LIFETIME");

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * The most recent REAL month (before `beforeMonth`) that has MONTHLY budget rows for
 * this project. Used by carry-forward. Scoped to row_type = 'MONTHLY' so Category
 * Master / Lifetime rows (whose budget_month is a filler value, not a real date) can
 * never be picked up and cloned as if they were a real prior month's budget. Returns
 * null if this project has no earlier REAL budget history.
 */
export async function latestMonthBefore(
  supabase: SupabaseClient,
  projectId: string,
  beforeMonth: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("project_budgets")
    .select("budget_month")
    .eq("project_id", projectId)
    .eq("row_type", "MONTHLY")
    .lt("budget_month", beforeMonth)
    .order("budget_month", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.budget_month ?? null;
}

/**
 * Category Master (Decisions 4/5/6) — every row_type = 'CATEGORY_MASTER' row for this
 * project. Exactly one row per (primary_category, secondary_category) pair, permanent —
 * never a "most recent month" dedup; the row IS the category, not a snapshot of some
 * month's copy of it.
 */
export async function listCategoryMasterRows(supabase: SupabaseClient, projectId: string): Promise<ProjectBudget[]> {
  const { data, error } = await supabase
    .from("project_budgets")
    .select("*")
    .eq("project_id", projectId)
    .eq("row_type", "CATEGORY_MASTER")
    .order("primary_category", { ascending: true })
    .order("secondary_category", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

/** The one Category Master row (if any) for this exact (project, primary, secondary) pair. */
export async function getCategoryMasterRow(
  supabase: SupabaseClient,
  projectId: string,
  primaryCategory: string,
  secondaryCategory: string | null
): Promise<ProjectBudget | null> {
  let query = supabase
    .from("project_budgets")
    .select("*")
    .eq("project_id", projectId)
    .eq("row_type", "CATEGORY_MASTER")
    .eq("primary_category", primaryCategory);
  query = secondaryCategory === null ? query.is("secondary_category", null) : query.eq("secondary_category", secondaryCategory);

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw error;
  }
  return data;
}

/** The one row (if any) for this exact project/category/REAL month — used when adding a
 *  category to check whether the currently-viewed month already has its own budget line
 *  for it. Always scoped to row_type = 'MONTHLY'; pass a real `month`, never a filler
 *  value (use getCategoryMasterRow for the Category Master row). */
export async function getByProjectCategoryMonth(
  supabase: SupabaseClient,
  projectId: string,
  primaryCategory: string,
  secondaryCategory: string | null,
  month: string
): Promise<ProjectBudget | null> {
  let query = supabase
    .from("project_budgets")
    .select("*")
    .eq("project_id", projectId)
    .eq("row_type", "MONTHLY")
    .eq("primary_category", primaryCategory)
    .eq("budget_month", month);
  query = secondaryCategory === null ? query.is("secondary_category", null) : query.eq("secondary_category", secondaryCategory);

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw error;
  }
  return data;
}

/** Renames a category across every REAL monthly row from `fromMonth` onward (Decision 5
 *  — a rename never touches months before the one it was made in). Matches the OLD
 *  (primary, secondary) pair; callers pass the new names. Never touches the Category
 *  Master row itself — the service updates that separately via getCategoryMasterRow. */
export async function renameCategoryFromMonth(
  supabase: SupabaseClient,
  projectId: string,
  oldPrimary: string,
  oldSecondary: string | null,
  newPrimary: string,
  newSecondary: string | null,
  fromMonth: string
): Promise<void> {
  let query = supabase
    .from("project_budgets")
    .update({ primary_category: newPrimary, secondary_category: newSecondary })
    .eq("project_id", projectId)
    .eq("row_type", "MONTHLY")
    .eq("primary_category", oldPrimary)
    .gte("budget_month", fromMonth);
  query = oldSecondary === null ? query.is("secondary_category", null) : query.eq("secondary_category", oldSecondary);

  const { error } = await query;
  if (error) {
    throw error;
  }
}

export async function insert(supabase: SupabaseClient, projectBudget: Omit<ProjectBudget, "id" | "created_at" | "updated_at">): Promise<ProjectBudget> {
  const { data, error } = await supabase
    .from("project_budgets")
    .insert(projectBudget)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function update(supabase: SupabaseClient, id: string, projectBudget: Partial<Omit<ProjectBudget, "id" | "created_at" | "updated_at">>): Promise<ProjectBudget> {
  const { data, error } = await supabase
    .from("project_budgets")
    .update(projectBudget)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function remove(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("project_budgets").delete().eq("id", id);

  if (error) {
    throw error;
  }
}
