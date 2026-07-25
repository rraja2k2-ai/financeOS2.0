-- Migration 016: Guard save_transaction's top-level `items` parameter.
--
-- Found during the Phase 1.1 JSON-handling audit that followed migration 015 (which
-- fixed the identical defect class for the per-item tags/search_keywords fields):
-- `from jsonb_array_elements(items) as item` had no type guard at all, unlike the
-- fields 015 fixed. Unguarded, the five required cases behave as:
--   key missing   -> rejected by the function signature before the body ever runs (no
--                    default on `items`) — not reachable, no change needed
--   SQL NULL      -> jsonb_array_elements is STRICT, so a NULL argument silently
--                    yields ZERO rows — a transaction_header would be created with no
--                    line items and no error raised. Silent data loss, not a crash.
--   JSON null      -> a real (non-SQL-NULL) jsonb scalar, so the STRICT shortcut does
--                    NOT apply -> jsonb_array_elements('null'::jsonb) throws
--                    22023 "cannot extract elements from a scalar" — the same crash
--                    signature migration 015 fixed for tags/search_keywords.
--   wrong type     -> object/string/number -> also throws 22023 (from an object) or
--                    the scalar variant above.
--   empty array    -> already fine: jsonb_array_elements('[]'::jsonb) yields zero rows,
--                    no error. Unchanged by this migration.
--   populated array -> already fine, unchanged.
--
-- Fix: fail fast with one clear, explicit exception instead of either a silent
-- zero-item save or a cryptic internal Postgres error — checked once at the top of the
-- function, before any insert, so a rejected call leaves nothing behind. This is the
-- ONLY behavioral change; header/items/attachment insert logic is otherwise byte-for-
-- byte identical to migration 015.
--
-- Not currently reachable by the app (services/capture/save-capture.service.ts's
-- validate() already rejects an empty items array before the RPC is ever called, and
-- `items` is always built as a real array), so this closes a latent gap rather than a
-- live bug — same category of risk migration 011 left open for months before it bit.
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

-- Function signature is unchanged, so PostgREST's cache entry already points at this
-- function — reload anyway for safety, matching 006/011/015's precedent.
notify pgrst, 'reload schema';

-- Verify after running:
--   select proname from pg_proc where proname = 'save_transaction';  -- 1 row
--   Then re-run: npm run db:verify:migrations
--   A real capture with a normal (non-empty) items array behaves identically to 015 —
--   this migration only changes behavior for null/wrong-type `items`, which the live
--   app never sends.
