-- Migration 002: Reconcile categorization_rules taxonomy + dedupe
--
-- Problem (found during TAD audit, July 2026):
--   1. categorization_rules used a coarse taxonomy (Food, Bills, Transport, Shopping, Health)
--      that does not match the real 41-category taxonomy seeded in the budgets table.
--      See constants/categories.ts for the canonical taxonomy this migrates to.
--   2. A seeding bug ran 4x, so every merchant_pattern has 4 duplicate rows with
--      identical priority (10) and identical categorization.
--
-- Grocery supermarkets (ntuc/fairprice/giant/cold storage/sheng siong) are left with
-- secondary_category = NULL: a whole-store merchant rule can't know whether a given
-- receipt is mostly Dairy & Eggs vs Vegetables vs Grains & Staples — that only becomes
-- knowable at line-item level during Phase 2 Classification (TAD-003 §11.2: "header
-- category is for at-a-glance display only; classify at item level for anything
-- precision-sensitive"). This requires secondary_category to be nullable — see the
-- companion domain/categorization-rule.ts change.
--
-- This migration is idempotent — safe to re-run.
-- Run in the Supabase SQL editor (Project → SQL Editor) against your project.

begin;

-- Step 0: secondary_category must accept NULL for whole-store merchant rules (see above).
alter table public.categorization_rules alter column secondary_category drop not null;

-- Step 1: Dedupe. Keep the earliest-created row per merchant_pattern, drop the rest.
delete from public.categorization_rules a
using public.categorization_rules b
where a.merchant_pattern = b.merchant_pattern
  and a.created_at > b.created_at;

-- Tie-breaker for any rows with identical created_at (keep lowest id).
delete from public.categorization_rules a
using public.categorization_rules b
where a.merchant_pattern = b.merchant_pattern
  and a.created_at = b.created_at
  and a.id > b.id;

-- Step 2: Remap old coarse taxonomy -> canonical taxonomy (constants/categories.ts).
update public.categorization_rules
set primary_category = case merchant_pattern
    when 'ntuc'         then 'Groceries'
    when 'fairprice'    then 'Groceries'
    when 'giant'        then 'Groceries'
    when 'cold storage' then 'Groceries'
    when 'sheng siong'  then 'Groceries'
    when 'toast box'    then 'Food & Dining'
    when 'starbucks'    then 'Food & Dining'
    when 'ya kun'       then 'Food & Dining'
    when 'mcdonalds'    then 'Food & Dining'
    when 'grabfood'     then 'Food & Dining'
    when 'foodpanda'    then 'Food & Dining'
    when 'transit'      then 'Transportation'
    when 'ez-link'      then 'Transportation'
    when 'gojek'        then 'Transportation'
    when 'grab'         then 'Transportation'
    when 'comfort'      then 'Transportation'
    when 'harvey norman' then 'Shopping'
    when 'courts'       then 'Shopping'
    when 'zara'         then 'Shopping'
    when 'uniqlo'       then 'Shopping'
    when 'sp services'  then 'Housing & Utilities'
    when 'sp group'     then 'Housing & Utilities'
    when 'm1'           then 'Housing & Utilities'
    when 'singtel'      then 'Housing & Utilities'
    when 'starhub'      then 'Housing & Utilities'
    when 'guardian'     then 'Healthcare'
    when 'unity'        then 'Healthcare'
    when 'watsons'      then 'Healthcare'
    else primary_category
  end,
  secondary_category = case merchant_pattern
    when 'ntuc'         then null  -- whole-store grocery merchant; see note above
    when 'fairprice'    then null
    when 'giant'        then null
    when 'cold storage' then null
    when 'sheng siong'  then null
    when 'toast box'    then 'Dining Out'
    when 'starbucks'    then 'Dining Out'
    when 'ya kun'       then 'Dining Out'
    when 'mcdonalds'    then 'Dining Out'
    when 'grabfood'     then 'Dining Out'
    when 'foodpanda'    then 'Dining Out'
    when 'transit'      then 'Public Transport'
    when 'ez-link'      then 'Public Transport'
    when 'gojek'        then 'Taxi & Ride Hailing'
    when 'grab'         then 'Taxi & Ride Hailing'
    when 'comfort'      then 'Taxi & Ride Hailing'
    when 'harvey norman' then 'Gadgets & Electronics'
    when 'courts'       then 'Gadgets & Electronics'
    when 'zara'         then 'Clothing & Apparel'
    when 'uniqlo'       then 'Clothing & Apparel'
    when 'sp services'  then 'Utilities'
    when 'sp group'     then 'Utilities'
    when 'm1'           then 'Internet & Mobile'
    when 'singtel'      then 'Internet & Mobile'
    when 'starhub'      then 'Internet & Mobile'
    when 'guardian'     then 'Medicines'
    when 'unity'        then 'Medicines'
    when 'watsons'      then 'Medicines'
    else secondary_category
  end
where merchant_pattern in (
  'ntuc','fairprice','giant','cold storage','sheng siong',
  'toast box','starbucks','ya kun','mcdonalds','grabfood','foodpanda',
  'transit','ez-link','gojek','grab','comfort',
  'harvey norman','courts','zara','uniqlo',
  'sp services','sp group','m1','singtel','starhub',
  'guardian','unity','watsons'
);

commit;

-- Verify after running:
--   select merchant_pattern, count(*) from public.categorization_rules group by 1 having count(*) > 1;
--   -- should return 0 rows (no more duplicates)
--   select distinct primary_category from public.categorization_rules order by 1;
--   -- should only show canonical taxonomy values (see constants/categories.ts)
--   select merchant_pattern, primary_category, secondary_category from public.categorization_rules order by 1;
--   -- grocery merchants (ntuc/fairprice/giant/cold storage/sheng siong) should show secondary_category = null
