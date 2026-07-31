-- Migration 020: Attachment Management MVP — "Keep Attachment" flag.
--
-- One additive column on receipt_attachments: a user-set flag that exempts an
-- attachment's original file from Manual Cleanup (see the app's
-- attachment-cleanup.service.ts). Default false — nothing is protected until the user
-- explicitly marks it. save_transaction is untouched: a newly saved attachment simply
-- takes the column default, same as any other omitted insert column.
--
-- Safe to re-run. Run in the Supabase SQL editor.

alter table public.receipt_attachments add column if not exists keep_attachment boolean not null default false;

comment on column public.receipt_attachments.keep_attachment is 'User-set flag (Keep Attachment) — when true, Manual Cleanup never deletes this attachment''s original Storage file.';

-- Verify after running:
--   select column_name, data_type, column_default, is_nullable from information_schema.columns
--     where table_name = 'receipt_attachments' and column_name = 'keep_attachment';
--   -- data_type = boolean, column_default = false, is_nullable = 'NO'
