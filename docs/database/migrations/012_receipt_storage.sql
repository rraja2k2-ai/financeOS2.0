-- Migration 012: Supabase Storage for receipt files (C4.1, finalized in C4.3).
--
-- Replaces the temporary base64-in-database receipt storage with a real Storage bucket.
-- The database now stores only a REFERENCE (storage_path) to each page's file.
--
--   1. Create the "receipts" bucket (private — not publicly readable by URL).
--   2. Add storage.objects RLS policies (INSERT/SELECT/UPDATE/DELETE) so the app's
--      anon-key client (same pattern as every table in this schema — see migration 009's
--      note) can manage objects scoped to this bucket only. The bucket stays PRIVATE.
--   3. Add storage_path + page_no to receipt_attachments (nullable — the existing legacy
--      row keeps working; only new rows populate them). No new table, no columns removed.
--   4. Index receipt_attachments.header_id (attachments are always looked up by header).
--
-- Idempotent and safe to run multiple times. Run in the Supabase SQL editor.

begin;

-- 1. Bucket (private: files are fetched via the API/service, not a public URL).
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- 2. RLS policies scoped to this bucket only, for the anon role the app authenticates as.
--    INSERT + SELECT + UPDATE + DELETE. `drop ... if exists` first keeps this re-runnable.
drop policy if exists "receipts anon insert" on storage.objects;
create policy "receipts anon insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'receipts');

drop policy if exists "receipts anon select" on storage.objects;
create policy "receipts anon select" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'receipts');

drop policy if exists "receipts anon update" on storage.objects;
create policy "receipts anon update" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'receipts')
  with check (bucket_id = 'receipts');

drop policy if exists "receipts anon delete" on storage.objects;
create policy "receipts anon delete" on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'receipts');

-- 3. receipt_attachments: minimal additive columns, existing columns left as-is.
alter table public.receipt_attachments add column if not exists storage_path text;
alter table public.receipt_attachments add column if not exists page_no integer;

comment on column public.receipt_attachments.storage_path is 'Supabase Storage path of the original receipt page.';
comment on column public.receipt_attachments.page_no is '1-based page number within the receipt.';

-- 4. Attachments are always fetched by their parent transaction — index the FK.
--    Guard on the COLUMN (not just the index name) so a pre-existing single-column
--    header_id index under any name is never duplicated.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'receipt_attachments'
      and indexdef like '%(header_id)%'
  ) then
    create index idx_receipt_attachments_header_id on public.receipt_attachments (header_id);
  end if;
end $$;

commit;

-- Verify after running:
--   select id, public from storage.buckets where id = 'receipts';           -- 1 row, public = false
--   select policyname from pg_policies where tablename = 'objects' and policyname like 'receipts %';  -- 4 rows
--   select column_name from information_schema.columns
--     where table_name = 'receipt_attachments' and column_name in ('storage_path', 'page_no');  -- 2 rows
--   select indexname from pg_indexes where tablename = 'receipt_attachments' and indexname = 'idx_receipt_attachments_header_id';  -- 1 row
