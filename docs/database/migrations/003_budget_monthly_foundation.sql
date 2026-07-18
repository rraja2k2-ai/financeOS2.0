-- Migration 003: Budget monthly-model foundation (on the old `budgets` table)
--
-- Prepares the OLD global `budgets` table for consolidation into project_budgets
-- (migration 004). Adds category_type + normalizes budget_month so migration 004 can
-- copy clean data across. This table is renamed to budgets_legacy at the end of 004 —
-- this migration is a stepping stone, not a final state.
--
--   1. Add category_type (income | expense) — keyed on (primary_category,
--      specific_category) because "Investments" is income for Stock Dividends but
--      expense for Gold / Global Stocks / Indian SIP.
--   2. Normalize budget_month to the 1st of the month (was an arbitrary '...-06'
--      day) so it is a clean month key for carry-forward + month-over-month compare.
--
-- Idempotent — safe to re-run. Run in Supabase SQL editor, BEFORE migration 004.

begin;

-- 1. category_type ------------------------------------------------------------
alter table public.budgets add column if not exists category_type text;

update public.budgets set category_type = 'income'
where (primary_category, specific_category) in (
  ('Cashback & Rewards', 'Cashback'),
  ('Interest Income',    'Bank Interest'),
  ('Investments',        'Stock Dividends'),
  ('Rental Income',      'Property Rent'),
  ('Salary',             'Bonus'),
  ('Salary',             'Regular Salary')
);

update public.budgets set category_type = 'expense' where category_type is null;

alter table public.budgets alter column category_type set not null;

-- 2. Normalize budget_month to first-of-month ---------------------------------
update public.budgets
set budget_month = date_trunc('month', budget_month)::date
where budget_month <> date_trunc('month', budget_month)::date;

commit;

-- Verify after running:
--   select distinct category_type from public.budgets;                 -- income, expense
--   select budget_month, count(*) from public.budgets group by 1;      -- month = YYYY-MM-01
--   select category_type, count(*) from public.budgets group by 1;     -- ~6 income, ~35 expense
