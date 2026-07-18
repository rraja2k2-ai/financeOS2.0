-- Migration 010: Project module foundation.
--
-- The projects table already has budget_type / budget_currency / budget_amount columns
-- (added out-of-band). This migration:
--   1. Adds the one missing Project Master field: description.
--   2. Gives budget_type a sane default + backfills existing nulls to 'Track Only' (a
--      project with no per-category budgets shows spending only, no budget comparison).
--      NOTE: budget_type is guarded by the check constraint chk_budget_type, which only
--      permits the exact strings 'Fixed' and 'Track Only' — do not use other casings.
--   3. Assigns the Generic project to any transaction that has no project (business rule:
--      "Generic is automatically assigned when no Project is specified"). There are a
--      couple of NULL-project rows in real data; this makes them show up under Generic
--      instead of being orphaned.
--
-- Per-category PROJECT budgets are stored in the existing project_budgets table under a
-- sentinel budget_month of 1900-01-01 (see services/finance/project.service.ts →
-- PROJECT_BUDGET_MONTH). Project budgets are lifetime, not monthly, so they deliberately
-- use one fixed month that can never collide with the Generic project's real monthly
-- household budget rows. No schema change is needed for that — the sentinel value reuses
-- the table and its existing unique index (budget_month, project_id, primary_category,
-- secondary_category).
--
-- Run in Supabase SQL editor. Safe to re-run.

begin;

-- 1. description column.
alter table public.projects add column if not exists description text;

-- 2. budget_type default + backfill (must match chk_budget_type: 'Fixed' | 'Track Only').
alter table public.projects alter column budget_type set default 'Track Only';
update public.projects set budget_type = 'Track Only' where budget_type is null;

-- 3. Assign NULL-project transactions to Generic.
update public.transaction_headers
set project_id = (select id from public.projects where project_name = 'Generic' limit 1)
where project_id is null
  and exists (select 1 from public.projects where project_name = 'Generic');

commit;

-- Verify after running:
--   select column_name from information_schema.columns
--     where table_name = 'projects' and column_name = 'description';       -- 1 row
--   select count(*) from public.transaction_headers where project_id is null;  -- 0
