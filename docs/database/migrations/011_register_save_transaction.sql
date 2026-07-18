-- Migration 011: (Re)register the atomic save_transaction RPC for the C4 save path.
--
-- Migration 005 defined save_transaction, but PostgREST's schema cache does not have it
-- (calls fail with PGRST202 "Could not find the function public.save_transaction..."). This
-- migration recreates the function (identical body to 005) and asks PostgREST to reload its
-- schema cache so the app can call it. With this in place, the C4 save commits header +
-- items + receipt_attachment in ONE Postgres transaction.
--
-- Until this is run, the app still saves correctly via a compensating fallback in
-- services/capture/save-capture.service.ts (sequential insert + rollback-on-failure), so
-- running this only upgrades the save to a true single-statement transaction.
--
-- Safe to re-run. Run in the Supabase SQL editor.

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
    primary_category, secondary_category, qty, unit_price, item_total
  )
  select
    new_header_id,
    header->>'receipt_id',
    item->>'item_description',
    case when item->'tags' is not null then array(select jsonb_array_elements_text(item->'tags')) else null end,
    item->>'item_group',
    case when item->'search_keywords' is not null then array(select jsonb_array_elements_text(item->'search_keywords')) else null end,
    item->>'primary_category',
    nullif(item->>'secondary_category', ''),
    item->>'qty',
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

-- Ask PostgREST to reload its schema cache so the function becomes callable immediately.
notify pgrst, 'reload schema';

-- Verify after running:
--   select proname from pg_proc where proname = 'save_transaction';  -- 1 row
