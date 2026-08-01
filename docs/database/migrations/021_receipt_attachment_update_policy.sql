-- Migration 021: receipt_attachments — add the missing anon UPDATE policy.
--
-- Root cause of the "Keep Attachment toggle reverts" bug (PR #19 final review):
-- receipt_attachments predates this migrations directory, and its base RLS policy set
-- was applied directly in the Supabase SQL editor before any of these files existed.
-- SELECT/INSERT/DELETE on this table are exercised constantly (viewing receipts, saving
-- a capture, deleting a transaction) and demonstrably work — but repositories/
-- receipt-attachment.repository.ts's update() had ZERO callers anywhere in the app until
-- the "Keep Attachment" feature added the first one. With no anon UPDATE policy, that
-- UPDATE was silently rejected by RLS, the API route's PATCH handler caught the error and
-- returned 500, and the Receipt Viewer's own (correct) revert-on-failure logic reverted
-- the optimistic UI change — which is exactly the reported symptom.
--
-- CLAUDE.md §9: "If a table's granular CRUD policies are ever missing, add the missing
-- granular policy" — this is that fix, in the exact anon_<verb>_<table> shape every other
-- table already uses. Single-user app (CLAUDE.md §2): no per-row scoping, matching every
-- other granular policy in this schema.
--
-- Idempotent and safe to re-run. Run in the Supabase SQL editor.

drop policy if exists "anon_update_receipt_attachments" on public.receipt_attachments;
create policy "anon_update_receipt_attachments" on public.receipt_attachments
  for update to anon, authenticated
  using (true)
  with check (true);

-- Verify after running:
--   select policyname, cmd from pg_policies
--     where tablename = 'receipt_attachments' order by policyname;
--   -- should now include anon_update_receipt_attachments (cmd = 'UPDATE') alongside
--   -- whatever the existing select/insert/delete policies are already named.
