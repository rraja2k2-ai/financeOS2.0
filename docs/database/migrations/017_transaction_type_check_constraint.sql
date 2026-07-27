-- Migration 017: Transaction Type Architecture — data mapping + validated CHECK constraint.
--
-- transaction_headers.transaction_type was a free-text column with no constraint at all.
-- The real data held 4 distinct legacy values (Title Case, seeded outside the app — the
-- live app itself had only ever written "Expense"):
--   Expense (72 rows), Payment (4), Transfer (2), Lending (1)
--
-- This milestone's approved five-value set is uppercase and different:
--   EXPENSE, INCOME, TRANSFER, REFUND, ADJUSTMENT
--
-- Mapping applied (reviewed and approved separately before this ran):
--   Expense                    -> EXPENSE
--   Payment / Transfer / Lending -> TRANSFER
-- All 7 non-Expense rows are either an internal move between two of your own accounts
-- (credit card bill payments, POSB -> Maribank Thama) or an external party with one side
-- null (Viveka, Rajesh) — every case fits TRANSFER under the new model.
--
-- Applied and validated live on 2026-07-26 — this file reflects what actually ran (the
-- constraint is fully validated, NOT `not valid`, since the data below was migrated
-- first). Resulting distribution: EXPENSE 120, TRANSFER 7 (EXPENSE grew from 72 as
-- ordinary app usage continued between the impact analysis and this migration running).
--
-- Safe to re-run (both UPDATEs are idempotent — a row already in the target value is a
-- no-op; the constraint add is guarded). Run in the Supabase SQL editor.

update public.transaction_headers set transaction_type = 'EXPENSE'  where transaction_type = 'Expense';
update public.transaction_headers set transaction_type = 'TRANSFER' where transaction_type in ('Payment', 'Transfer', 'Lending');

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transaction_headers_transaction_type_check'
  ) then
    alter table public.transaction_headers
      add constraint transaction_headers_transaction_type_check
      check (transaction_type in ('EXPENSE', 'INCOME', 'TRANSFER', 'REFUND', 'ADJUSTMENT'));
  end if;
end $$;

-- Verify after running:
--   select conname, convalidated from pg_constraint where conname = 'transaction_headers_transaction_type_check';
--   -- convalidated should be `true`
--   select transaction_type, count(*) from public.transaction_headers group by transaction_type order by 1;
--   -- expect only EXPENSE/TRANSFER rows (no legacy Title Case values remain)
--   Then run a real capture and confirm it saves successfully with transaction_type = 'EXPENSE'.
