-- Migration 018: Receipt Intelligence Foundation — additive item attribute columns.
--
-- Prepares transaction_items for future structured receipt data (unit of measure,
-- package size) without touching qty's existing free-text design (migration 005's
-- "qty is always free text as printed/spoken" decision is unchanged — these are NEW,
-- separate columns, not a replacement or a recalculation of qty).
--
-- unit_price already exists (numeric, nullable, added before this migration) and
-- already round-trips through save_transaction via the same nullif('') pattern used
-- below — only `unit` and `pack_size` are genuinely new here.
--
-- All three stay NULL for every existing row and every new capture until a future
-- milestone (AI extraction, manual entry, or a future Workspace UI) actually populates
-- them. Additive only — no data migration, no existing behavior changes.
--
-- Safe to re-run. Run in the Supabase SQL editor.

alter table public.transaction_items add column if not exists unit text;
alter table public.transaction_items add column if not exists pack_size text;

-- Re-create save_transaction (migration 016's version) to also accept/persist unit and
-- pack_size, same nullif('') pattern already used for secondary_category/unit_price.
-- Signature unchanged; behavior for callers that omit these keys is identical to
-- before (item->>'unit' / item->>'pack_size' on a missing key returns SQL NULL).
create or replace function public.save_transaction(
  header jsonb,
  items jsonb,
  attachment jsonb default null
)
returns jsonb
language plpgsql
as $$
declare
  new_header_id uuid;
  result_header jsonb;
  result_items jsonb;
  result_attachment jsonb;
begin
  if jsonb_typeof(items) is distinct from 'array' then
    raise exception 'save_transaction: items must be a JSON array (got %)', coalesce(jsonb_typeof(items), 'SQL NULL')
      using errcode = '22023';
  end if;

  insert into public.transaction_headers (
    receipt_id, transaction_date, merchant, transaction_type, primary_category,
    source_account_id, target_account_id, project_id, currency, original_amount,
    exchange_rate, sgd_total_amount, comments, status
  )
  select
    header->>'receipt_id',
    (header->>'transaction_date')::date,
    header->>'merchant',
    header->>'transaction_type',
    header->>'primary_category',
    nullif(header->>'source_account_id', '')::uuid,
    nullif(header->>'target_account_id', '')::uuid,
    nullif(header->>'project_id', '')::uuid,
    header->>'currency',
    (header->>'original_amount')::numeric,
    nullif(header->>'exchange_rate', '')::numeric,
    (header->>'sgd_total_amount')::numeric,
    header->>'comments',
    coalesce(header->>'status', 'Confirmed')
  returning id into new_header_id;

  insert into public.transaction_items (
    header_id, receipt_id, item_description, tags, item_group, search_keywords,
    primary_category, secondary_category, qty, unit, pack_size, unit_price, item_total
  )
  select
    new_header_id,
    header->>'receipt_id',
    item->>'item_description',
    case when jsonb_typeof(item->'tags') = 'array'
      then array(select jsonb_array_elements_text(item->'tags')) else null end,
    item->>'item_group',
    case when jsonb_typeof(item->'search_keywords') = 'array'
      then array(select jsonb_array_elements_text(item->'search_keywords')) else null end,
    item->>'primary_category',
    nullif(item->>'secondary_category', ''),
    item->>'qty',
    nullif(item->>'unit', ''),
    nullif(item->>'pack_size', ''),
    nullif(item->>'unit_price', '')::numeric,
    (item->>'item_total')::numeric
  from jsonb_array_elements(items) as item;

  if attachment is not null then
    insert into public.receipt_attachments (
      header_id, original_file_url, thumbnail_url, ocr_raw_text, ai_extraction_json,
      file_size_bytes, mime_type
    )
    values (
      new_header_id,
      attachment->>'original_file_url',
      attachment->>'thumbnail_url',
      attachment->>'ocr_raw_text',
      attachment->'ai_extraction_json',
      nullif(attachment->>'file_size_bytes', '')::integer,
      attachment->>'mime_type'
    )
    returning to_jsonb(receipt_attachments.*) into result_attachment;
  end if;

  select to_jsonb(h.*) into result_header from public.transaction_headers h where h.id = new_header_id;
  select jsonb_agg(to_jsonb(i.*)) into result_items from public.transaction_items i where i.header_id = new_header_id;

  return jsonb_build_object(
    'header', result_header,
    'items', coalesce(result_items, '[]'::jsonb),
    'attachment', result_attachment
  );
end;
$$;

-- Function signature is unchanged, so PostgREST's cache entry already points at this
-- function — reload anyway for safety, matching 006/011/015/016's precedent.
notify pgrst, 'reload schema';

-- Verify after running:
--   select column_name, data_type, is_nullable from information_schema.columns
--     where table_name = 'transaction_items' and column_name in ('unit', 'pack_size', 'unit_price');
--   -- all three should show is_nullable = 'YES'
--   Then run a real capture and confirm it saves successfully, with unit/pack_size/
--   unit_price all NULL on the new transaction_items row(s) (nothing populates them yet).
