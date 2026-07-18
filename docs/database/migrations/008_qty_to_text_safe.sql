-- Migration 008: transaction_items.qty numeric -> text, via temp-column swap.
--
-- Safer than a direct `ALTER COLUMN qty TYPE text` because it never leaves the table in
-- a partially-migrated state: the old column stays intact and queryable until the very
-- last step (rename), so if anything goes wrong partway, nothing is lost and it's obvious
-- what to retry. A direct ALTER is fine in principle (numeric -> text is always a lossless
-- cast — no row's data can be "invalid" for this direction) but fails outright if a view,
-- generated column, or check constraint depends on qty (see 007_diagnose_qty_column.sql).
--
-- IMPORTANT: if 007's diagnostic found a VIEW depending on qty, drop it before running
-- this (save its definition first!) and recreate it afterward, referencing qty_new /
-- the renamed column as needed. If it found a GENERATED column depending on qty, that
-- column's generation expression must be redefined (or dropped and recomputed) — this
-- migration does not attempt that automatically since it depends on what that column is.
--
-- Run in Supabase SQL editor. Safe to re-run (checks before each step).

begin;

-- 1. Add the new text column alongside the old one.
alter table public.transaction_items add column if not exists qty_text text;

-- 2. Copy every value across. numeric -> text via ::text is always lossless.
update public.transaction_items set qty_text = qty::text where qty_text is null;

-- 3. Verify before swapping (uncomment to check manually first):
-- select id, qty, qty_text from public.transaction_items limit 20;

-- 4. Drop the old numeric column, rename the new one into its place.
alter table public.transaction_items drop column qty;
alter table public.transaction_items rename column qty_text to qty;

commit;

-- Verify after running:
--   select column_name, data_type from information_schema.columns
--     where table_name = 'transaction_items' and column_name = 'qty';
--   -- should show data_type = 'text'
--   select qty from public.transaction_items limit 10;
--   -- should show values like '1', '0.348', etc. as text
