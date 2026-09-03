-- Let the dashboard UI upload ticket attachments from the browser.
--
-- 029_ticket_attachments.sql created the private `ticket-attachments` bucket
-- for desk-inbound, which writes with the service-role key and so bypasses
-- RLS entirely. That is why 029 gave storage.objects a SELECT policy only:
-- nothing in the browser ever wrote to the bucket.
--
-- The hub can now attach files when creating a ticket and from the ticket
-- drawer, and those uploads run as the signed-in user. Without an INSERT
-- policy on storage.objects every one of them fails with a 403 "new row
-- violates row-level security policy", so add the matching write gate.
--
-- Table-side writes already work: 029's `authorized users all` policy on
-- ticket_attachments is FOR ALL, so the row insert is covered.
--
-- Same allowlist gate as the read policy and the rest of the dashboard
-- (008_auth_lockdown). Idempotent — DROP POLICY IF EXISTS then CREATE — and
-- it touches no tables, so it is safe to re-run. Nothing here depends on the
-- `tickets` tables, which live only in the live database (see the NOTE in
-- 029). Run this in the Supabase SQL editor on the live project; there is no
-- `supabase db push` in this repo.

DROP POLICY IF EXISTS "authorized users write ticket attachments" ON storage.objects;
CREATE POLICY "authorized users write ticket attachments" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'ticket-attachments' AND is_authorized_user());

-- Still deliberately no DELETE policy, as in 029: nothing in the app removes
-- attachments, so there is no remove control for this to back. The upload path
-- cleans up an orphan blob after a failed row insert on a best-effort basis
-- only — that call is a no-op without a DELETE policy, which is why the
-- client treats its failure as non-fatal. Add the policy together with a
-- remove-attachment control and a retention pass.
