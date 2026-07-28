-- Migration 019: Account Posting Engine — atomic balance-delta apply RPC.
--
-- No new tables, no new columns. accounts.current_balance already exists (set once at
-- account creation, per account-management.service.ts) and stays a simple stored field —
-- this is NOT a general ledger, NOT journal entries, NOT double-entry accounting. It is
-- one small stored procedure that increments/decrements one or more account rows'
-- current_balance in a single Postgres transaction, so a Transfer's two legs (or an
-- Edit's netted reversal+reapply) either both land or neither does.
--
-- Called exclusively from services/finance/account-posting.service.ts — the one posting
-- engine (Account Posting Engine milestone). Never called directly from the UI or from
-- any other service.
--
-- Safe to re-run. Run in the Supabase SQL editor.

create or replace function public.apply_account_balance_deltas(deltas jsonb)
returns void
language plpgsql
as $$
begin
  if jsonb_typeof(deltas) is distinct from 'array' then
    raise exception 'apply_account_balance_deltas: deltas must be a JSON array (got %)', coalesce(jsonb_typeof(deltas), 'SQL NULL')
      using errcode = '22023';
  end if;

  update public.accounts a
  set current_balance = a.current_balance + d.delta,
      updated_at = now()
  from (
    select (elem->>'accountId')::uuid as account_id, (elem->>'delta')::numeric as delta
    from jsonb_array_elements(deltas) as elem
  ) d
  where a.id = d.account_id;
end;
$$;

-- Ask PostgREST to reload its schema cache so the function becomes callable immediately.
notify pgrst, 'reload schema';

-- Verify after running:
--   select proname from pg_proc where proname = 'apply_account_balance_deltas';  -- 1 row
