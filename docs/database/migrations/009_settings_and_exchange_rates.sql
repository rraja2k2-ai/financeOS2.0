-- Migration 009: Exchange Rates as the single source of truth for Base Currency.
--
-- There is NO separate settings table. The active Base Currency is stored directly in
-- exchange_rates.base_currency (every row shares the same value); changing the base is a
-- straight `UPDATE exchange_rates SET base_currency = '<selected>'`. This migration:
--   0. Drops the old app_settings table if a previous run created it (now removed).
--   1. Adds exchange_rates.last_updated (stamped on every save from the Exchange Rates screen).
--   2. Collapses any duplicate (base_currency, target_currency) pairs to the most recent row.
--   3. Adds a unique index on (base_currency, target_currency) so the screen's "Save All"
--      UPSERT can never create duplicate pairs.
--
-- Run in Supabase SQL editor. Safe to re-run (checks before each step).

begin;

-- 0. Remove the superseded app_settings table (Base Currency now lives in exchange_rates).
drop table if exists public.app_settings;

-- 1. last_updated column (stamped on every UPSERT from the Exchange Rates screen).
alter table public.exchange_rates add column if not exists last_updated timestamptz not null default now();

-- 2. Collapse any existing duplicate (base_currency, target_currency) pairs down to the
--    single most recent row (by rate_date, then created_at) before adding the unique
--    constraint — this table has "no history" as a product rule, so only the latest value
--    per pair should survive.
delete from public.exchange_rates a
using public.exchange_rates b
where a.base_currency = b.base_currency
  and a.target_currency = b.target_currency
  and (a.rate_date, a.created_at, a.id) < (b.rate_date, b.created_at, b.id);

-- 3. Enforce no-duplicate-pairs going forward (required for ON CONFLICT upsert).
create unique index if not exists exchange_rates_base_target_uk
  on public.exchange_rates (base_currency, target_currency);

commit;

-- Verify after running:
--   select to_regclass('public.app_settings');  -- should be NULL (dropped)
--   select base_currency, target_currency, count(*) from public.exchange_rates
--     group by 1, 2 having count(*) > 1;  -- should return zero rows
