-- Migration 024: accounts.display_order — persistent, user-controlled account ordering.
--
-- Master Data & Account Management Refactor, Decision 7. One additive column; every
-- existing read path (accounts.service.ts, master-data.service.ts, net-cash.service.ts,
-- Activity's account filter) already goes through account.repository.ts's list(), which
-- this migration's companion code change orders by this column — one change, same order
-- everywhere, per the decision's own requirement.
--
-- Safe to re-run: the ALTER is idempotent (IF NOT EXISTS), and the backfill only ever
-- fills rows that are still NULL, so re-running never reshuffles an order a user has
-- already customized via the app.
--
-- Run in the Supabase SQL editor.

alter table public.accounts add column if not exists display_order integer;

-- One-time backfill: assigns every existing account a display_order matching its current
-- EFFECTIVE on-screen position (accounts.service.ts's own grouping — currency SGD -> INR
-- -> other, then account type Savings -> CreditCard -> Investment -> LoanToOthers, then
-- currency again to keep "Other currencies" sub-grouped, then creation order as the final
-- tiebreak) — so ordering goes live with zero visible reshuffle the first time it's read.
with ordered as (
  select id,
    row_number() over (
      order by
        case currency when 'SGD' then 0 when 'INR' then 1 else 2 end,
        case account_type
          when 'Savings' then 0
          when 'CreditCard' then 1
          when 'Investment' then 2
          when 'LoanToOthers' then 3
          else 4
        end,
        currency,
        created_at
    ) as rn
  from public.accounts
)
update public.accounts a
set display_order = ordered.rn
from ordered
where a.id = ordered.id
  and a.display_order is null;

-- Verify after running:
--   select account_name, currency, account_type, display_order from public.accounts
--     order by display_order;
--   -- should read top-to-bottom exactly as the Accounts screen shows them today
