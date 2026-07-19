-- Migration 014: account_mapping_rules — Fix 4, Simple Account Mapping Rules.
--
-- Purpose: improve source-account identification only. This is NOT a rule engine —
-- it is a flat keyword -> account lookup, passed to the AI as a hint alongside
-- ACCOUNTS/CATEGORIES/PROJECTS (see prompts/receipt-processing.prompt.ts). The AI still
-- performs the final reasoning; these rows are hints, not a deterministic override.
--
-- Why a NEW table instead of reusing categorization_rules:
--   categorization_rules matches MERCHANT NAME text to CATEGORY (primary/secondary),
--   with an optional default_account_hint riding along for that specific merchant.
--   This feature matches PAYMENT TEXT (a card's last 4 digits, or a payment keyword
--   like PAYNOW/NETS/ATM) to an ACCOUNT directly, independent of merchant. Reusing
--   categorization_rules would force every account-mapping row to also carry a
--   primary_category/transaction_type/priority it doesn't need, and would make
--   getByMerchantPattern() (merchant-substring lookup) accidentally match payment
--   keywords/card digits against merchant names. Keeping this a separate, minimal
--   table avoids conflating two different concerns and keeps categorization_rules
--   (merchant -> category) completely untouched.
--
-- Each rule has exactly: keyword, mapped_account, is_active. Nothing else — see
-- Fix 4 spec ("Each rule should contain only Keyword, Mapped Account, Active").
--
-- Matching (done by the AI per its prompt instructions, not by app code): a rule's
-- keyword matches if it appears ANYWHERE in the extracted payment text or user
-- context (e.g. keyword "2148" matches "2148", "****2148", "XXXX2148", "Card 2148",
-- "Ending 2148") — one row covers every variation, no per-variation duplicate rows.
--
-- Idempotent and safe to run multiple times. Run in the Supabase SQL editor.

begin;

create table if not exists public.account_mapping_rules (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  mapped_account text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.account_mapping_rules is 'Fix 4: flat keyword -> account hints for source-account identification. Hints only — the AI performs final reasoning. Not a rule engine.';
comment on column public.account_mapping_rules.keyword is 'Payment keyword (PAYNOW, NETS, ATM) or card last-4-digits (2148). Matches as a substring anywhere in the extracted payment text/user context.';
comment on column public.account_mapping_rules.mapped_account is 'Exact account_name from public.accounts.';

-- One rule per keyword — mirrors the exact bug migration 002 had to clean up for
-- categorization_rules (merchant_pattern had no uniqueness, so a reseed created 4x
-- duplicates). Case-insensitive so "PAYNOW" and "paynow" can't coexist as two rows.
create unique index if not exists account_mapping_rules_keyword_unique_idx
  on public.account_mapping_rules (lower(keyword));

-- RLS is enabled with the same anon_select/anon_insert/anon_update/anon_delete policy
-- pattern used on every other table in this schema (see the Database Security Audit,
-- 2026-07-19) — anon key access, full CRUD, no per-row scoping.
alter table public.account_mapping_rules enable row level security;

commit;

-- Optional seed — the example mappings from the Fix 4 spec, using this project's
-- REAL account names (docs/database/accounts_rows.sql / the accounts table): the
-- spec's illustrative "Cash Wallet" does not exist here, the actual cash account is
-- named "Cash". Adjust/remove before running if these don't match your accounts.
insert into public.account_mapping_rules (keyword, mapped_account) values
  ('PAYNOW', 'POSB Bank'),
  ('NETS',   'POSB Bank'),
  ('ATM',    'Cash'),
  ('2148',   'SC Credit Card'),
  ('2764',   'POSB Credit Card'),
  ('9222',   'Mari Credit Card'),
  ('7161',   'HSBC Credit Card'),
  ('8982',   'Citi Credit Card')
on conflict (lower(keyword)) do nothing;

-- Verify after running:
--   select keyword, mapped_account, is_active from public.account_mapping_rules order by keyword;
