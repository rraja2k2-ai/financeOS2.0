-- Migration 013: capture_queue — the C5 Capture Inbox work queue.
--
-- One row per captured receipt that hasn't reached Activity yet. This is NOT a
-- transaction table (no amounts/ledger data) — it's a temporary queue: the receipt's
-- Storage paths + user context + the AI result while the capture moves through
-- Uploading → Processing → Ready for Review → Failed → (Saved = row deleted after the
-- reviewed transaction is persisted). Receipt files are uploaded to the private
-- "receipts" bucket at enqueue time and are REUSED by the final save (receipt_attachments
-- points at the same paths), so nothing is uploaded twice.
--
-- Idempotent and safe to run multiple times. Run in the Supabase SQL editor.

begin;

create table if not exists public.capture_queue (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'Processing'
    check (status in ('Uploading', 'Processing', 'Ready for Review', 'Failed', 'Saved')),
  user_context text not null default '',
  -- Ordered receipt pages already in Storage: [{ storagePath, mimeType, fileSizeBytes, pageNo }]
  pages jsonb not null default '[]'::jsonb,
  -- The AI pipeline's structured result, set when status becomes 'Ready for Review'.
  result_json jsonb,
  error_message text,
  -- Extracted merchant, denormalised for the Inbox card display.
  merchant text,
  capture_source text not null default 'text',
  ai_provider text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.capture_queue is 'Capture Inbox work queue — receipts between capture and save. Not a transaction table.';
comment on column public.capture_queue.pages is 'Ordered receipt pages already uploaded to the receipts bucket: [{storagePath, mimeType, fileSizeBytes, pageNo}].';
comment on column public.capture_queue.result_json is 'AI pipeline result once processing succeeds (drives the Review screen).';

-- The app talks to Supabase with the anon key (same pattern as every other table in this
-- schema — see migration 009's note). RLS is enabled with a single permissive policy
-- covering the app's full CRUD access (see the Database Security Audit, 2026-07-19) —
-- intentionally one custom ALL policy rather than split per-verb, since capture_queue
-- is a transient work-queue with no differential access pattern between verbs.
alter table public.capture_queue enable row level security;

create index if not exists idx_capture_queue_status on public.capture_queue (status);

commit;

-- Ask PostgREST to reload its schema cache so the new table becomes queryable immediately
-- (a brand-new table otherwise returns PGRST205 "Could not find the table" until the cache
-- refreshes on its own — see migration 011's note for the same issue with the RPC).
notify pgrst, 'reload schema';

-- Verify after running:
--   select to_regclass('public.capture_queue');   -- not null
--   select count(*) from public.capture_queue;    -- 0 on a fresh install
