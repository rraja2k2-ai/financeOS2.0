-- Migration 028: Drop the pre-Version-1 investment placeholder tables.
--
-- investment_events, investment_snapshots, and investment_account_summary predate
-- migration tracking and were never wired to any service or UI (CLAUDE.md's Parking Lot:
-- "Data model exists; no UI/workflow built on top of it yet"). Investment Portfolio
-- Version 1 (see CLAUDE.md §10) supersedes this design entirely: portfolio metrics
-- (Capital Invested, Current Market Value, Portfolio Gain/Loss, Dividends/Interest) are
-- derived on read from transaction_headers plus accounts.current_balance — there is no
-- persisted investment-specific table, snapshot mechanism, or second accounting engine.
-- investment_events had no foreign key back to transaction_headers and would have been a
-- second, independent ledger; investment_snapshots/investment_account_summary were
-- materialized caches for a mechanism (Adjust/Correct Balance → accounts.current_balance)
-- that already exists and already posts through the Account Posting Engine. All three are
-- dead schema — no repository, service, or component has referenced them at any point.
--
-- Idempotent and safe to re-run. Run in the Supabase SQL editor.

begin;

drop table if exists public.investment_events cascade;
drop table if exists public.investment_snapshots cascade;
drop table if exists public.investment_account_summary cascade;

commit;

-- Verify after running:
--   select table_name from information_schema.tables
--     where table_schema = 'public'
--       and table_name in ('investment_events', 'investment_snapshots', 'investment_account_summary');
--   -- 0 rows
