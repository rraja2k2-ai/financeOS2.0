-- Migration 022: Nudge PostgREST to reload its schema cache (Keep Attachment column).
--
-- Root cause of the Keep Attachment PATCH's HTTP 500 (PR #19 final review, follow-up):
-- "PGRST204 | Could not find the 'keep_attachment' column of 'receipt_attachments' in
-- the schema cache." Migration 020 added the column with a plain `alter table`, but
-- PostgREST caches the schema and doesn't pick up new columns automatically — the exact
-- same class of issue migration 006 already documented for a new FUNCTION ("the function
-- exists, the API layer just doesn't know yet"). The column genuinely exists in Postgres;
-- migration 021's RLS UPDATE policy was correct hygiene but was never the actual blocker
-- here — PostgREST was rejecting the request before RLS ever got evaluated, because it
-- didn't recognize the column name at all.
--
-- Run this in the Supabase SQL editor. Safe to re-run any time.

notify pgrst, 'reload schema';

-- If this doesn't fix it within ~30 seconds, the alternate manual fix is:
-- Supabase Dashboard -> Settings -> API -> find "Reload schema cache" and click it.
-- Then retry the Keep Attachment toggle — the PATCH should return 200, not PGRST204.
