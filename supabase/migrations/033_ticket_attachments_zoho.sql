-- Zoho Desk attachments on concierge tickets.
--
-- Before this, `zoho-desk-sync` only ever wrote to `tickets`: it never asked
-- Zoho for a ticket's files, so anything a client attached in Desk existed
-- only in Zoho. `ticket_attachments` (029) was built for the email path and
-- keys its dedupe off `graph_attachment_id`, which is always NULL for a
-- Zoho-sourced row — so a re-sync had nothing to compare against and would
-- have re-downloaded and duplicated every file.
--
-- This adds Zoho's own attachment id and the uniqueness guard that makes the
-- sync idempotent. The guard is on (ticket_id, zoho_attachment_id), NOT
-- (message_id, ...) like the Graph one: the sync attaches files to the ticket
-- and leaves `message_id` NULL, so message_id carries no information here.
--
-- NOTE (same caveat as 026 and 029): `tickets` and `ticket_messages` are NOT
-- defined in these migrations — they exist only in the live database. Run this
-- in the Supabase SQL editor on the live project; there is no `supabase db
-- push` in this repo.

ALTER TABLE IF EXISTS ticket_attachments
  ADD COLUMN IF NOT EXISTS zoho_attachment_id TEXT;

-- One row per Zoho attachment per ticket, so a repeated sync cannot duplicate
-- rows even if the application-level dedupe is skipped. Partial, because
-- zoho_attachment_id is NULL for anything not sourced from Zoho Desk.
--
-- Non-fatal, mirroring 029: if the live table already holds duplicates (from a
-- sync run before the guard existed), the index cannot be built — say so and
-- carry on rather than aborting the whole migration. De-duplicate by hand and
-- re-run this file to get the guard.
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_attachments_zoho
    ON ticket_attachments(ticket_id, zoho_attachment_id)
    WHERE zoho_attachment_id IS NOT NULL;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'uq_ticket_attachments_zoho not created: ticket_attachments already has duplicate (ticket_id, zoho_attachment_id) rows. De-duplicate and re-run.';
END $$;

COMMENT ON COLUMN ticket_attachments.zoho_attachment_id IS
  'Zoho Desk attachment id, set by the zoho-desk-sync edge function. Used to skip files already stored so a re-sync neither duplicates rows nor re-downloads bytes. NULL for attachments that arrived by email (see graph_attachment_id).';
