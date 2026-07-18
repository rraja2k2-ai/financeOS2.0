-- Migration 004: Consolidate budgets into project_budgets — every budget has a project
--
-- Decision (user, July 2026): stop maintaining two budget tables. Every budget line
-- belongs to a project — the Generic project for regular monthly categories (Groceries,
-- Dining, etc.), a named project (Thailand Trip 2026) for everything else. Carry-forward
-- is the SAME mechanism for every project: cloning the most recent month's rows into a
-- new month, uniformly. One-time projects don't need a "recurring" flag — if a carried-
-- forward line isn't wanted, the user just deletes that row for the new month.
--
-- This migration:
--   1. Adds budget_month + category_type to project_budgets (project_budgets currently
--      has no month at all — every row was a single one-time envelope).
--   2. Normalizes the casing bug already present in project_budgets (e.g. 'grocery' /
--      'vegetables' -> 'Groceries' / 'Vegetables') against the canonical taxonomy in
--      constants/categories.ts, and assigns those pre-existing rows a budget_month from
--      their created_at (best-effort, since they predate the month concept).
--   3. Copies every row from `budgets` (the old Generic-only global table, prepared by
--      migration 003) into project_budgets under the Generic project.
--   4. Renames `budgets` to `budgets_legacy` rather than dropping it — reversible safety
--      net. Nothing in the app reads budgets_legacy; drop it yourself once you've
--      confirmed project_budgets looks right.
--
-- Run 002 and 003 BEFORE this one. Idempotent — safe to re-run.
-- Run in Supabase SQL editor.

begin;

-- 1. New columns ---------------------------------------------------------------
alter table public.project_budgets add column if not exists budget_month date;
alter table public.project_budgets add column if not exists category_type text;

-- 2. Normalize pre-existing project_budgets rows --------------------------------
-- Known casing bug from manual test inserts. Extend this CASE list if you find more.
update public.project_budgets
set primary_category = case lower(primary_category)
      when 'grocery'    then 'Groceries'
      when 'groceries'  then 'Groceries'
      else primary_category
    end,
    secondary_category = case lower(secondary_category)
      when 'vegetables' then 'Vegetables'
      when 'fruits'     then 'Fruits'
      else secondary_category
    end
where budget_month is null;

update public.project_budgets
set category_type = coalesce(category_type, 'expense'),
    budget_month = coalesce(budget_month, date_trunc('month', created_at)::date)
where budget_month is null or category_type is null;

-- 3. Copy `budgets` (Generic, global) into project_budgets -----------------------
insert into public.project_budgets
  (project_id, primary_category, secondary_category, currency, budget_amount, exchange_rate, budget_amount_sgd, category_type, budget_month, created_at, updated_at)
select
  (select id from public.projects where project_name = 'Generic' limit 1),
  b.primary_category,
  b.specific_category,
  b.currency,
  b.budget_amount,
  1.0,  -- budgets table had no exchange_rate column; SGD-denominated so rate is 1
  b.budget_amount_sgd,
  b.category_type,
  b.budget_month,
  b.created_at,
  b.updated_at
from public.budgets b
where not exists (
  select 1 from public.project_budgets pb
  where pb.project_id = (select id from public.projects where project_name = 'Generic' limit 1)
    and pb.budget_month = b.budget_month
    and pb.primary_category = b.primary_category
    and pb.secondary_category = b.specific_category
);

-- 4. Prevent duplicate lines per (project, month, category) ----------------------
alter table public.project_budgets alter column budget_month set not null;
alter table public.project_budgets alter column category_type set not null;
create unique index if not exists project_budgets_month_project_category_uk
  on public.project_budgets (budget_month, project_id, primary_category, secondary_category);

-- 5. Retire the old global table (renamed, not dropped) ---------------------------
alter table if exists public.budgets rename to budgets_legacy;

commit;

-- Verify after running:
--   select p.project_name, count(*) from public.project_budgets pb
--     join public.projects p on p.id = pb.project_id group by 1;
--   -- Generic should show ~41 rows for the migrated month; India Trip 2026 shows its own
--
--   select distinct primary_category, secondary_category from public.project_budgets
--     order by 1, 2;
--   -- eyeball this for anything not in constants/categories.ts CATEGORY_TAXONOMY
