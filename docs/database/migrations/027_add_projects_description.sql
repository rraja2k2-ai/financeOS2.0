-- Migration 027: Add the missing projects.description column (production fix).
--
-- Root cause: migration 010_project_module.sql was written to add this column, but a
-- production data export (projects_rows.sql) showed the column absent from the actual
-- INSERT statement's column list — meaning migration 010 was never actually run against
-- this database (or only ran locally/elsewhere). This is NOT a PostgREST schema-cache
-- staleness issue (unlike migration 022's keep_attachment case) — the column genuinely
-- doesn't exist, so PostgREST's PGRST204 "column not found" error is accurate. Creating a
-- new project (app/projects/actions.ts's createProjectAction) fails with a 500 because it
-- always writes a `description` value.
--
-- Idempotent and safe to re-run. Run in the Supabase SQL editor.

alter table public.projects add column if not exists description text;

-- Nudge PostgREST to pick up the new column immediately rather than waiting for its own
-- refresh cycle (same step migration 022 used for the analogous keep_attachment case).
notify pgrst, 'reload schema';

-- Verify after running:
--   select column_name from information_schema.columns
--     where table_name = 'projects' and column_name = 'description';
--   -- 1 row
--
-- Then retry creating a project from the app — POST /projects should return 200, not
-- PGRST204/500.
