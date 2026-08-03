-- Migration 026: recurring_rules — Recurring Transactions feature.
--
-- One new table, no child tables. A recurring rule is a living template (NOT a copy of a
-- historical transaction, NOT a reference to one) — it stores the current definition of
-- what to generate next; editing it only ever affects transactions generated after the
-- edit. Generated transactions are ordinary transaction_headers rows created through the
-- existing transactionService.createTransaction() (services/transaction.service.ts) and
-- posted through the existing Account Posting Engine — nothing here bypasses that flow,
-- and this is not a second posting engine.
--
-- Generated transactions carry NO link back to this table (no recurring_rule_id) —
-- next_due_date is the sole progress cursor for "what's next," advanced immediately after
-- each generated transaction, which is also what makes running Generate repeatedly safe
-- (there is nothing before next_due_date left to regenerate).
--
-- end_mode/end_value: a single nullable date column covers all three UI end conditions.
-- NEVER -> end_value null. ON_DATE -> end_value is that date. AFTER_COUNT -> end_value is
-- computed ONCE (start_date + interval * N) when the rule is created/edited and stored as
-- a plain date from then on — generation never counts occurrences, it only ever compares
-- next_due_date against end_value. end_mode itself is never read by generation; it exists
-- purely so the edit form can redisplay which mode the user originally chose.
--
-- Supports only EXPENSE / INCOME / TRANSFER / ADJUSTMENT (REFUND excluded — no product
-- scenario for a recurring refund) and only single-line-item transactions (multi-line is
-- out of scope; amount/category here map directly to the one generated item).
--
-- Idempotent and safe to re-run. Run in the Supabase SQL editor.

begin;

create table if not exists public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  transaction_type text not null check (transaction_type in ('EXPENSE', 'INCOME', 'TRANSFER', 'ADJUSTMENT')),
  merchant text not null default '',
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null,
  primary_category text not null,
  secondary_category text,
  source_account_id uuid references public.accounts(id),
  target_account_id uuid references public.accounts(id),
  project_id uuid references public.projects(id),
  comments text,
  interval_count integer not null check (interval_count > 0),
  interval_unit text not null check (interval_unit in ('WEEK', 'MONTH', 'YEAR')),
  start_date date not null,
  next_due_date date not null,
  end_mode text not null default 'NEVER' check (end_mode in ('NEVER', 'ON_DATE', 'AFTER_COUNT')),
  end_value date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.recurring_rules is 'Recurring Transactions — a living template. Editing it only affects future-generated transactions; already-generated ones (ordinary transaction_headers rows) are never touched.';
comment on column public.recurring_rules.next_due_date is 'Sole generation progress cursor. Advanced immediately after each generated transaction — no separate occurrence counter or linkage back from transaction_headers is needed.';
comment on column public.recurring_rules.end_value is 'NEVER -> null. ON_DATE -> the chosen date. AFTER_COUNT -> computed once from start_date + interval * N at create/edit time, then treated exactly like ON_DATE by generation.';

-- The one query this feature runs: due, active rules, oldest-due first.
create index if not exists recurring_rules_due_idx on public.recurring_rules (is_active, next_due_date);

alter table public.recurring_rules enable row level security;

drop policy if exists "anon_select_recurring_rules" on public.recurring_rules;
create policy "anon_select_recurring_rules" on public.recurring_rules
  for select to anon, authenticated
  using (true);

drop policy if exists "anon_insert_recurring_rules" on public.recurring_rules;
create policy "anon_insert_recurring_rules" on public.recurring_rules
  for insert to anon, authenticated
  with check (true);

drop policy if exists "anon_update_recurring_rules" on public.recurring_rules;
create policy "anon_update_recurring_rules" on public.recurring_rules
  for update to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "anon_delete_recurring_rules" on public.recurring_rules;
create policy "anon_delete_recurring_rules" on public.recurring_rules
  for delete to anon, authenticated
  using (true);

commit;

-- Verify after running:
--   select column_name from information_schema.columns
--     where table_name = 'recurring_rules' order by ordinal_position;
--   select policyname, cmd from pg_policies
--     where tablename = 'recurring_rules' order by policyname;
--   -- 4 rows: SELECT, INSERT, UPDATE, DELETE
