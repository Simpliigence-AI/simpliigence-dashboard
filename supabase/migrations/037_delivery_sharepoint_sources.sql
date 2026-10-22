-- 037 — SharePoint folder per project, and document text for the AI.
--
--   * A project can be linked to one SharePoint (or OneDrive for Business)
--     folder. The delivery-sharepoint edge function lists that folder and its
--     subfolders into delivery_documents (source 'sharepoint'); the files stay
--     in SharePoint and open there. It re-syncs nightly (pg_cron) and on demand.
--   * Text is pulled out of every document — SharePoint files and uploads —
--     into delivery_document_text, so "Generate with AI" writes user stories,
--     test cases and process flows from the actual SOW, notes and transcripts.
--
-- Access: 'project-plans' tab, as 033–036. Safe to re-run.

ALTER TABLE delivery_projects  ADD COLUMN IF NOT EXISTS sp_folder_url  TEXT;
ALTER TABLE delivery_projects  ADD COLUMN IF NOT EXISTS sp_folder_name TEXT;
ALTER TABLE delivery_projects  ADD COLUMN IF NOT EXISTS sp_drive_id    TEXT;
ALTER TABLE delivery_projects  ADD COLUMN IF NOT EXISTS sp_item_id     TEXT;
ALTER TABLE delivery_projects  ADD COLUMN IF NOT EXISTS sp_synced_at   TIMESTAMPTZ;
ALTER TABLE delivery_projects  ADD COLUMN IF NOT EXISTS sp_sync_error  TEXT;

ALTER TABLE delivery_documents ADD COLUMN IF NOT EXISTS sp_item_id  TEXT;
ALTER TABLE delivery_documents ADD COLUMN IF NOT EXISTS sp_drive_id TEXT;
ALTER TABLE delivery_documents ADD COLUMN IF NOT EXISTS sp_path     TEXT;   -- folder path inside the linked folder
-- pending | ok | none (nothing readable, e.g. video) | error
ALTER TABLE delivery_documents ADD COLUMN IF NOT EXISTS text_status TEXT;
ALTER TABLE delivery_documents ADD COLUMN IF NOT EXISTS text_error  TEXT;
ALTER TABLE delivery_documents ADD COLUMN IF NOT EXISTS text_chars  INT;

ALTER TABLE delivery_documents DROP CONSTRAINT IF EXISTS delivery_documents_source_check;
ALTER TABLE delivery_documents ADD CONSTRAINT delivery_documents_source_check
  CHECK (source IN ('upload','generated','link','sharepoint'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_documents_sp ON delivery_documents(project_id, sp_item_id) WHERE sp_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_documents_text_pending ON delivery_documents(project_id) WHERE text_status = 'pending';

CREATE TABLE IF NOT EXISTS delivery_document_text (
  document_id  TEXT PRIMARY KEY REFERENCES delivery_documents(id) ON DELETE CASCADE,
  project_id   TEXT NOT NULL,
  body         TEXT NOT NULL,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delivery_document_text_project ON delivery_document_text(project_id);
ALTER TABLE delivery_document_text ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tab: project-plans read" ON delivery_document_text;
CREATE POLICY "tab: project-plans read" ON delivery_document_text FOR SELECT TO authenticated
  USING (has_tab('project-plans','view'));
-- No write policy: rows come only from the delivery-sharepoint function (service role).

-- Existing files (uploads, Governance copies, generated docs) get their text pulled on the next run.
UPDATE delivery_documents SET text_status = 'pending'
 WHERE text_status IS NULL AND storage_path IS NOT NULL;
UPDATE delivery_documents SET text_status = 'none'
 WHERE text_status IS NULL AND storage_path IS NULL;

-- New uploads are queued for text extraction automatically.
CREATE OR REPLACE FUNCTION delivery_documents_text_queue() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.text_status IS NULL THEN
    NEW.text_status := CASE WHEN NEW.storage_path IS NOT NULL OR NEW.sp_item_id IS NOT NULL THEN 'pending' ELSE 'none' END;
  ELSIF TG_OP = 'UPDATE' AND NEW.storage_path IS DISTINCT FROM OLD.storage_path AND NEW.storage_path IS NOT NULL THEN
    NEW.text_status := 'pending';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_delivery_documents_text_queue ON delivery_documents;
CREATE TRIGGER trg_delivery_documents_text_queue BEFORE INSERT OR UPDATE ON delivery_documents
  FOR EACH ROW EXECUTE FUNCTION delivery_documents_text_queue();

-- Change log: keep the SharePoint sync and text extraction out of it. The
-- sync writes one 'sharepoint.sync' summary event instead of one per file.
CREATE OR REPLACE FUNCTION delivery_audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  entity  TEXT := TG_ARGV[0];
  newj    JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  oldj    JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  rowj    JSONB := COALESCE(newj, oldj);
  pid     TEXT := CASE WHEN entity = 'project' THEN rowj ->> 'id' ELSE rowj ->> 'project_id' END;
  label   TEXT := COALESCE(rowj ->> 'name', rowj ->> 'title', left(rowj ->> 'description', 120), left(rowj ->> 'text', 120), rowj ->> 'week_ending');
  changed TEXT[];
  op      TEXT := lower(TG_OP);
BEGIN
  IF entity = 'document' AND rowj ->> 'source' = 'sharepoint'
     AND COALESCE(auth.jwt() ->> 'role', 'service_role') = 'service_role' THEN
    RETURN NULL;   -- written by the nightly/on-demand sync
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(k ORDER BY k) INTO changed
    FROM jsonb_object_keys(newj) k
    WHERE k NOT IN ('updated_at', 'updated_by', 'text_status', 'text_error', 'text_chars',
                    'sp_synced_at', 'sp_sync_error', 'import_error')
      AND newj -> k IS DISTINCT FROM oldj -> k;
    IF changed IS NULL THEN RETURN NULL; END IF;   -- touch-only / housekeeping update
  END IF;
  INSERT INTO delivery_audit (project_id, actor, action, payload)
  VALUES (pid, delivery_actor(), entity || '.' || op,
          jsonb_strip_nulls(jsonb_build_object('id', rowj ->> 'id', 'label', label, 'fields', to_jsonb(changed))));
  RETURN NULL;
END $$;

-- Nightly: re-sync every linked folder and pull text for anything pending.
-- (Uses the DELIVERY_CRON_SECRET vault secret created in 036.)
DO $$
BEGIN
  PERFORM cron.unschedule('delivery-sharepoint-sync') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'delivery-sharepoint-sync');
  PERFORM cron.schedule('delivery-sharepoint-sync', '0 7 * * *', $cron$
    SELECT net.http_post(
      url := 'https://mhmxlubithnidopmkwgt.supabase.co/functions/v1/delivery-sharepoint',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_KEY'),
        'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'DELIVERY_CRON_SECRET')),
      body := '{"action":"cron"}'::jsonb,
      timeout_milliseconds := 150000);
  $cron$);
  -- Every 10 minutes: read any files still waiting (new uploads, big folders). Returns at once when there are none.
  PERFORM cron.unschedule('delivery-document-text') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'delivery-document-text');
  PERFORM cron.schedule('delivery-document-text', '*/10 * * * *', $cron$
    SELECT net.http_post(
      url := 'https://mhmxlubithnidopmkwgt.supabase.co/functions/v1/delivery-sharepoint',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_KEY'),
        'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'DELIVERY_CRON_SECRET')),
      body := '{"action":"cron-extract"}'::jsonb,
      timeout_milliseconds := 150000)
    WHERE EXISTS (SELECT 1 FROM delivery_documents WHERE text_status IN ('pending','reading'));
  $cron$);
END $$;
