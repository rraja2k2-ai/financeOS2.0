-- Migration 025: project_budgets row_type discriminator (Category Master + Lifetime
-- Project Budgets), replacing sentinel-date row identity entirely.
--
-- Master Data & Account Management Refactor, Decisions 4/5/6 — REWORKED a second time,
-- before this migration was ever run (neither v1 nor v2 was ever executed).
--
-- v1 anchored Category Master rows to Generic's EARLIEST REAL budget month — conflated
-- category identity (master data) with monthly budget planning (temporal data). Rejected.
--
-- v2 introduced a reserved sentinel month, CATEGORY_MASTER_MONTH = '1900-01-01', plus an
-- is_category_master boolean. This fixed v1's problem but created a NEW one, caught during
-- pre-execution review: services/finance/project.service.ts already had its own,
-- pre-existing sentinel for a completely different concept — PROJECT_BUDGET_MONTH, also
-- '1900-01-01', used for named projects' non-monthly LIFETIME budget lines. The two
-- sentinels were chosen independently and collided exactly. Root cause: budget_month was
-- being asked to represent two unrelated things — calendar month, and row identity. Any
-- future feature reaching for "pick another fake date" would have hit the same failure
-- mode again.
--
-- v3 (this file): budget_month goes back to meaning ONLY calendar information. Row
-- identity is carried by one explicit discriminator column, row_type, with three values:
--   - MONTHLY          — a real calendar-month budget line (existing household/project
--                         monthly budgets). budget_month is meaningful.
--   - LIFETIME         — a named project's lifetime (non-monthly) budget line, replacing
--                         the PROJECT_BUDGET_MONTH sentinel comparison. budget_month is a
--                         NOT NULL filler value only, never read for identity.
--   - CATEGORY_MASTER  — a category identity row (Generic project only), replacing the
--                         is_category_master boolean and CATEGORY_MASTER_MONTH sentinel.
--                         budget_month is a NOT NULL filler value only, never read.
--
-- No new table — still project_budgets, still one budget system. is_archived is kept
-- (category metadata, orthogonal to row identity, meaningful only on CATEGORY_MASTER
-- rows). is_category_master is dropped from the design entirely — it never existed in the
-- live schema (v2 was never executed), so there is nothing to migrate away from; row_type
-- is the only discriminator that ever ships.
--
-- Idempotent — the ALTER TABLEs use IF NOT EXISTS / guarded constraint drop-then-add; the
-- MONTHLY→LIFETIME backfill only touches rows still at the old sentinel value (a no-op on
-- re-run, since those rows will already read 'LIFETIME'); the Category Master seed's NOT
-- EXISTS check (scoped to row_type = 'CATEGORY_MASTER') means re-running never creates
-- duplicate master rows.
--
-- Run in the Supabase SQL editor.

alter table public.project_budgets add column if not exists is_archived boolean not null default false;

alter table public.project_budgets add column if not exists row_type text not null default 'MONTHLY';

alter table public.project_budgets drop constraint if exists project_budgets_row_type_check;
alter table public.project_budgets add constraint project_budgets_row_type_check
  check (row_type in ('MONTHLY', 'LIFETIME', 'CATEGORY_MASTER'));

comment on column public.project_budgets.is_archived is 'Category Master only — true retires a category: no longer offered in Capture/Review/Budget''s "add category" list, no longer copied into future months. Meaningless on MONTHLY/LIFETIME rows.';
comment on column public.project_budgets.row_type is 'Row discriminator — MONTHLY (real calendar-month budget), LIFETIME (named project lifetime budget line), or CATEGORY_MASTER (category identity row, Generic project only). The ONLY signal used for row identity; budget_month must never be compared against a sentinel value for this purpose again.';

-- Backfill: every existing row defaulted to 'MONTHLY' above. Reclassify the pre-existing
-- Lifetime Project Budget rows, which have always lived at budget_month = '1900-01-01'
-- (the PROJECT_BUDGET_MONTH sentinel, services/finance/project.service.ts). This is the
-- one place budget_month is read for identity in this migration — a one-time bootstrap
-- against data written before row_type existed, not a pattern application code repeats.
update public.project_budgets
set row_type = 'LIFETIME'
where budget_month = '1900-01-01' and row_type = 'MONTHLY';

-- Seed Category Master rows (Generic project). budget_month is filler ('1900-01-01' is
-- fine to reuse here — it no longer carries any identity meaning now that row_type
-- exists; nothing will ever compare it against this value again).
do $$
declare
  v_generic_id uuid;
begin
  select id into v_generic_id from public.projects where project_name = 'Generic' limit 1;
  if v_generic_id is null then
    raise notice 'Migration 025: no Generic project found — skipping category seed.';
    return;
  end if;

  insert into public.project_budgets
    (project_id, budget_month, primary_category, secondary_category, category_type, currency, budget_amount, exchange_rate, budget_amount_sgd, is_archived, row_type)
  select v_generic_id, date '1900-01-01', t.primary_category, t.secondary_category, t.category_type, 'SGD', 0, 1, 0, false, 'CATEGORY_MASTER'
  from (values
    ('Cashback & Rewards', 'Cashback', 'income'),
    ('Interest Income', 'Bank Interest', 'income'),
    ('Investments', 'Stock Dividends', 'income'),
    ('Rental Income', 'Property Rent', 'income'),
    ('Salary', 'Bonus', 'income'),
    ('Salary', 'Regular Salary', 'income'),
    ('Education', 'Books & Stationery', 'expense'),
    ('Education', 'School Fees', 'expense'),
    ('Education', 'Tuition', 'expense'),
    ('Family Support', 'Gifts & Festivals', 'expense'),
    ('Family Support', 'Allowances', 'expense'),
    ('Food & Dining', 'Dining Out', 'expense'),
    ('Groceries', 'Dairy & Eggs', 'expense'),
    ('Groceries', 'Fruits', 'expense'),
    ('Groceries', 'Grains & Staples', 'expense'),
    ('Groceries', 'Meat & Seafood', 'expense'),
    ('Groceries', 'Snacks & Beverages', 'expense'),
    ('Groceries', 'Vegetables', 'expense'),
    ('Healthcare', 'Medical Expenses', 'expense'),
    ('Healthcare', 'Medicines', 'expense'),
    ('Housing', 'House Rent', 'expense'),
    ('Housing & Utilities', 'Home Maintenance', 'expense'),
    ('Housing & Utilities', 'Internet & Mobile', 'expense'),
    ('Housing & Utilities', 'Utilities', 'expense'),
    ('Insurance', 'Critical Illness Insurance', 'expense'),
    ('Insurance', 'Health Insurance', 'expense'),
    ('Insurance', 'Life Insurance', 'expense'),
    ('Insurance', 'Personal Accident Insurance', 'expense'),
    ('Insurance', 'Term Insurance', 'expense'),
    ('Investments', 'Global Stocks (US/HK)', 'expense'),
    ('Investments', 'Gold Investments', 'expense'),
    ('Investments', 'Indian Stocks / SIP', 'expense'),
    ('Leisure & Entertainment', 'Entertainment', 'expense'),
    ('Leisure & Entertainment', 'Subscriptions', 'expense'),
    ('Leisure & Entertainment', 'Travel', 'expense'),
    ('Lending', 'Loans to Others', 'expense'),
    ('Miscellaneous', 'Miscellaneous', 'expense'),
    ('Shopping', 'Clothing & Apparel', 'expense'),
    ('Shopping', 'Gadgets & Electronics', 'expense'),
    ('Transportation', 'Public Transport', 'expense'),
    ('Transportation', 'Taxi & Ride Hailing', 'expense')
  ) as t(primary_category, secondary_category, category_type)
  where not exists (
    select 1 from public.project_budgets pb
    where pb.project_id = v_generic_id
      and pb.row_type = 'CATEGORY_MASTER'
      and pb.primary_category = t.primary_category
      and pb.secondary_category = t.secondary_category
  );
end $$;

-- Verify after running:
--   select column_name from information_schema.columns
--     where table_name = 'project_budgets' and column_name in ('is_archived', 'row_type');
--   -- 2 rows
--
--   select row_type, count(*) from public.project_budgets group by row_type;
--   -- MONTHLY: your existing real monthly rows; LIFETIME: your existing project lifetime
--   -- budget rows (0 if you've never set one); CATEGORY_MASTER: >= 40
--
--   select count(*) from public.project_budgets
--     where row_type = 'MONTHLY' and budget_month = '1900-01-01';
--   -- 0 — confirms no real monthly row was ever accidentally written to the old sentinel
--
--   select count(*) from public.project_budgets
--     where row_type in ('LIFETIME', 'CATEGORY_MASTER') and budget_month <> '1900-01-01';
--   -- 0, informational only — both currently reuse the same filler value, which is fine
--   -- now that row_type (not budget_month) is what every query actually branches on
--
-- Rollback (manual, if ever needed):
--   delete from public.project_budgets where row_type = 'CATEGORY_MASTER';
--   update public.project_budgets set row_type = 'MONTHLY' where row_type = 'LIFETIME';
--   alter table public.project_budgets drop constraint if exists project_budgets_row_type_check;
--   alter table public.project_budgets drop column if exists row_type;
--   alter table public.project_budgets drop column if exists is_archived;
