-- Migration 015: Fix save_transaction's tags/search_keywords array handling.
--
-- Bug (found during Performance Optimization Phase 1.1, after migration 011 finally
-- got save_transaction registered with PostgREST and it ran against a real payload for
-- the first time): the app deliberately sends `tags: null` and `search_keywords: null`
-- in every save (services/capture/save-capture.service.ts — "Unused by this milestone").
-- When that null crosses the RPC boundary as JSON, item->'tags' evaluates to the JSONB
-- value `null` (a real, non-SQL-NULL jsonb scalar), so migration 011's
-- `item->'tags' is not null` guard was TRUE, and jsonb_array_elements_text() was called
-- on a JSON scalar null, failing every save with:
--   22023  cannot extract elements from a scalar
--
-- Fix: gate entry into jsonb_array_elements_text() on jsonb_typeof(...) = 'array'
-- instead of an `is not null` check. This is the only behavioral change — everything
-- else in the function (identical to 011) is untouched. Correctly handles all five
-- cases for both tags and search_keywords:
--   key missing        -> item->'tags' is SQL NULL           -> typeof is SQL NULL -> else -> null
--   SQL NULL            -> item->'tags' is SQL NULL           -> typeof is SQL NULL -> else -> null
--   JSON null            -> item->'tags' is jsonb 'null'       -> typeof = 'null'    -> else -> null
--   empty array ([])      -> item->'tags' is jsonb '[]'         -> typeof = 'array'   -> then -> '{}'::text[]
--   populated array        -> item->'tags' is a jsonb array      -> typeof = 'array'   -> then -> populated text[]
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
    case when jsonb_typeof(item->'tags') = 'array'
      then array(select jsonb_array_elements_text(item->'tags')) else null end,
    item->>'item_group',
    case when jsonb_typeof(item->'search_keywords') = 'array'
      then array(select jsonb_array_elements_text(item->'search_keywords')) else null end,
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

-- Function signature (name + parameter list) is unchanged from 011, so PostgREST's
-- existing cache entry already points at this function — but reload anyway for safety,
-- matching 006/011's precedent.
notify pgrst, 'reload schema';

-- Verify after running:
--   select proname from pg_proc where proname = 'save_transaction';  -- 1 row
--   Then re-run: npm run db:verify:migrations
--   Then run a real capture with a receipt that has multiple line items and confirm no
--   22023 error and no fallback ("Header Insert (compensation path...)" absent from the
--   timing report).
