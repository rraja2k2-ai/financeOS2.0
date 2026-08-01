-- Migration 023: Drop budgets_legacy — final cleanup of the pre-project_budgets table.
--
-- Migration 004 (docs/database/migrations/004_consolidate_budgets_into_project_budgets.sql)
-- copied every row from the old global `budgets` table into `project_budgets` (under the
-- Generic project) and renamed `budgets` to `budgets_legacy` rather than dropping it
-- outright, as a reversible safety net. Its own comment said: "Nothing in the app reads
-- budgets_legacy; drop it yourself once you've confirmed project_budgets looks right."
--
-- Post-migration architecture audit (2026-08-01) re-confirmed independently, months later,
-- that no repository, service, API route, Server Action, or component references
-- `budgets_legacy` or `budgets` anywhere in the codebase. project_budgets is untouched by
-- this migration.
--
-- Idempotent — safe to re-run (DROP TABLE IF EXISTS is a no-op once the table is gone).
-- Run in the Supabase SQL editor.

drop table if exists public.budgets_legacy;

-- Verify after running:
--   select table_name from information_schema.tables
--     where table_schema = 'public' and table_name in ('budgets', 'budgets_legacy');
--   -- should return zero rows
