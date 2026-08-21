-- Attachments on concierge tickets — files AND the inline images an HTML
-- email body references as src="cid:...".
--
-- Before this, desk-inbound never asked Graph for attachments at all, so an
-- email's pictures were not merely unrendered: the bytes were never saved.
-- desk-inbound now uploads each `#microsoft.graph.fileAttachment` to the
-- private `ticket-attachments` bucket and records one row here.
--
-- NOTE (same caveat as 026): the `tickets` and `ticket_messages` tables are
-- NOT defined in these migrations — they exist only in the live database,
-- created alongside the desk-inbound edge function. So this file must run on a
-- database where they may or may not be present. Everything below is written
-- to be a no-op on re-run and to succeed on a fresh database: the foreign keys
-- are added only if their parent table actually exists, and the table itself
-- has no hard dependency on them. Run this in the Supabase SQL editor on the
-- live project.
--
-- No `description_html` column is added, on purpose. The rich body is already
-- stored: desk-inbound writes it to `ticket_messages.body_html` for every
-- inbound message, and the drawer renders the body_html of the message the
-- ticket was created from. A second copy on `tickets` would need a migration
-- against a table this repo cannot see, and would then have to be kept in sync
-- with the message row. `tickets.description` keeps the plain-text flattening
-- for list views and search.

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id                   TEXT PRIMARY KEY,          -- nanoid, minted by desk-inbound
  ticket_id            TEXT NOT NULL,
  message_id           TEXT,                      -- ticket_messages row this arrived on
  file_name            TEXT NOT NULL,
  content_type         TEXT,
  size_bytes           BIGINT,
  storage_path         TEXT NOT NULL,             -- object key in the ticket-attachments bucket
  graph_attachment_id  TEXT,                      -- Graph's id; used to dedupe a repair pass
  is_inline            BOOLEAN NOT NULL DEFAULT FALSE,
  content_id           TEXT,                      -- Graph contentId, matches the body's cid:
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Columns added defensively: the table may already exist in live from the
-- unmerged attachments branch, which had neither is_inline nor content_id.
ALTER TABLE IF EXISTS ticket_attachments
  ADD COLUMN IF NOT EXISTS is_inline           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS content_id          TEXT,
  ADD COLUMN IF NOT EXISTS graph_attachment_id TEXT,
  ADD COLUMN IF NOT EXISTS message_id          TEXT;

CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket  ON ticket_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_attachments_message ON ticket_attachments(message_id);
-- Inline lookup is "give me this ticket's cid-addressable images".
CREATE INDEX IF NOT EXISTS idx_ticket_attachments_inline  ON ticket_attachments(ticket_id, is_inline);

-- One row per Graph attachment per message, so a repeated repair pass cannot
-- duplicate rows even if the application-level dedupe is skipped. Partial,
-- because graph_attachment_id is null for anything not sourced from Graph.
--
-- Non-fatal: if the live table already holds duplicates (it could, if it was
-- created by the unmerged attachments branch), the index cannot be built — say
-- so and carry on rather than aborting the whole migration. Dedupe by hand and
-- re-run this file to get the guard.
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_attachments_graph
    ON ticket_attachments(message_id, graph_attachment_id)
    WHERE graph_attachment_id IS NOT NULL;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'uq_ticket_attachments_graph not created: ticket_attachments already has duplicate (message_id, graph_attachment_id) rows. De-duplicate and re-run.';
END $$;

-- Foreign keys, only where the parent exists (see the NOTE above). Both
-- cascade so deleting a ticket cannot leave orphan rows.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'tickets')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_attachments_ticket_id_fkey')
  THEN
    ALTER TABLE ticket_attachments
      ADD CONSTRAINT ticket_attachments_ticket_id_fkey
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'ticket_messages')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_attachments_message_id_fkey')
  THEN
    ALTER TABLE ticket_attachments
      ADD CONSTRAINT ticket_attachments_message_id_fkey
      FOREIGN KEY (message_id) REFERENCES ticket_messages(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Same allowlist gate as the rest of the dashboard (008_auth_lockdown).
ALTER TABLE ticket_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authorized users all" ON ticket_attachments;
CREATE POLICY "authorized users all" ON ticket_attachments
  FOR ALL
  TO authenticated
  USING (is_authorized_user())
  WITH CHECK (is_authorized_user());

-- Private bucket. Email attachments are client data and can be anything, so
-- there is no public read: the UI asks for a short-lived signed URL instead
-- (see useConciergeStore.attachmentSignedUrls). desk-inbound writes with the
-- service-role key, which bypasses RLS, so no INSERT policy is needed.
INSERT INTO storage.buckets (id, name, public)
VALUES ('ticket-attachments', 'ticket-attachments', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "authorized users read ticket attachments" ON storage.objects;
CREATE POLICY "authorized users read ticket attachments" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'ticket-attachments' AND is_authorized_user());

-- Deliberately no DELETE policy: nothing in the app removes objects today, so
-- deleting a ticket cascades the rows but leaves the blobs behind. Add a
-- policy (and a cleanup pass) when retention is decided.

COMMENT ON TABLE ticket_attachments IS
  'Files and inline images from inbound ticket emails. Bytes live in the private ticket-attachments Storage bucket at storage_path; is_inline + content_id link an image to the cid: reference in ticket_messages.body_html.';
