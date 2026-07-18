-- Migration 006: Nudge PostgREST to reload its schema cache
--
-- migration 005 created save_transaction fine in Postgres, but Supabase's PostgREST
-- API layer caches the schema and doesn't always pick up new functions automatically.
-- "Could not find the function ... in the schema cache" is PostgREST's classic
-- symptom for this — the function exists, the API layer just doesn't know yet.
--
-- Run this in the Supabase SQL editor. Safe to re-run any time.

notify pgrst, 'reload schema';

-- If this doesn't fix it within ~30 seconds, the alternate manual fix is:
-- Supabase Dashboard -> Settings -> API -> find "Reload schema cache" and click it.
-- Then re-run: npm run db:verify:migrations
