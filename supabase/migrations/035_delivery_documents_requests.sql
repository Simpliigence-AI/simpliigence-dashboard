-- Delivery Governance → Dashboard, phase 3: project documents and client
-- requests with the scope-creep classifier. Builds on 033/034.
--
-- Documents
--   Files live in the private Storage bucket 'delivery-documents' at
--   <project_id>/<document_id>/<file name>. The Documents tab opens them with
--   a short-lived signed URL; scope-classify reads frozen SOWs from there to
--   give Claude the contract text. A row can instead be a link to a file kept
--   elsewhere (SharePoint, Drive): source='link' and web_url set.
--
--   Governance kept its 120 files on its Render disk (/data/uploads).
--   legacy_id / legacy_path record where each came from; the
--   governance-docs-import function downloads each one through the
--   Governance API and fills in storage_path. Rows with legacy_id set and no
--   storage_path are the ones still to move.
--
-- Client requests
--   Anything the client asks for mid-project. The scope-classify edge
--   function compares the request with the project's frozen requirements and
--   exclusions and returns a verdict:
--     green  in scope — absorb it
--     amber  unclear — ask the client / architect
--     red    out of scope — raise a change request
--   A PM can override the verdict; the first verdict is kept in
--   original_verdict with the reason in appeal_resolution.
--
-- Access: same 'project-plans' tab. Safe to re-run.

CREATE TABLE IF NOT EXISTS delivery_documents (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES delivery_projects(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  doc_type       TEXT,                              -- SOW | Requirements | Design | Meeting | Status | Test Cases | ...
  source         TEXT NOT NULL DEFAULT 'upload',    -- upload | generated | link
  version        TEXT,
  state          TEXT NOT NULL DEFAULT 'review',    -- draft | review | frozen
  storage_path   TEXT,                              -- object key in 'delivery-documents'
  mime_type      TEXT,
  web_url        TEXT,                              -- for source='link' rows
  legacy_id      TEXT,                              -- Governance documents.id
  legacy_path    TEXT,                              -- Governance Render path
  import_error   TEXT,                              -- last failed move attempt
  size_bytes     BIGINT,
  modified_at    TIMESTAMPTZ,
  supersedes_id  TEXT REFERENCES delivery_documents(id) ON DELETE SET NULL,
  added_by       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (state IN ('draft', 'review', 'frozen')),
  CHECK (source IN ('upload', 'generated', 'link'))
);

CREATE TABLE IF NOT EXISTS delivery_requests (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES delivery_projects(id) ON DELETE CASCADE,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  requester           TEXT,
  source              TEXT,                         -- Client Email | Verbal / Meeting | Teams | Manual | ...
  text                TEXT NOT NULL,
  verdict             TEXT,                         -- green | amber | red; null until classified
  confidence          NUMERIC(4,3),
  impact_days         INTEGER,
  impact_hours        INTEGER,
  matched             TEXT,                         -- the clause it matched, or why nothing did
  detail              TEXT,                         -- classifier reasoning
  classifier          TEXT,                         -- claude | rules | hybrid | manual ...
  state               TEXT NOT NULL DEFAULT 'open', -- open | awaiting-clarification | applied | cr-raised | declined
  cr_id               TEXT REFERENCES delivery_change_requests(id) ON DELETE SET NULL,
  original_verdict    TEXT,
  appeal_state        TEXT NOT NULL DEFAULT 'none', -- none | resolved
  appeal_reason       TEXT,
  appeal_resolution   TEXT,
  appeal_resolved_by  TEXT,
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (verdict IS NULL OR verdict IN ('green', 'amber', 'red')),
  CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS idx_delivery_documents_project ON delivery_documents(project_id, modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_requests_project  ON delivery_requests(project_id, received_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['delivery_documents','delivery_requests'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_touch ON %1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_touch BEFORE UPDATE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION delivery_touch_updated_at()', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "tab: project-plans" ON %I', t);
    EXECUTE format($p$CREATE POLICY "tab: project-plans" ON %I FOR ALL TO authenticated
                      USING (has_tab('project-plans','view'))
                      WITH CHECK (has_tab('project-plans','edit'))$p$, t);
  END LOOP;
END $$;

-- ── Storage bucket ───────────────────────────────────────────────────────
-- Private; 250 MB per file covers the meeting recordings Governance held
-- (largest 184 MB). The project-wide upload limit must be at least this.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('delivery-documents', 'delivery-documents', false, 262144000)
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit, public = false;

DROP POLICY IF EXISTS "delivery-documents read"   ON storage.objects;
DROP POLICY IF EXISTS "delivery-documents insert" ON storage.objects;
DROP POLICY IF EXISTS "delivery-documents update" ON storage.objects;
DROP POLICY IF EXISTS "delivery-documents delete" ON storage.objects;
CREATE POLICY "delivery-documents read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'delivery-documents' AND has_tab('project-plans','view'));
CREATE POLICY "delivery-documents insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'delivery-documents' AND has_tab('project-plans','edit'));
CREATE POLICY "delivery-documents update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'delivery-documents' AND has_tab('project-plans','edit'));
CREATE POLICY "delivery-documents delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'delivery-documents' AND has_tab('project-plans','edit'));

-- ── One-off: lets pg_cron drive governance-docs-import ────────────────────
-- The function accepts an X-Import-Secret header that matches the vault
-- secret DELIVERY_IMPORT_SECRET. Only service_role may call this check.
-- Drop both (and the function) once Render is shut down.
CREATE OR REPLACE FUNCTION public.delivery_import_secret_ok(p_secret text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets
                 WHERE name = 'DELIVERY_IMPORT_SECRET' AND decrypted_secret = p_secret)
$$;
REVOKE ALL ON FUNCTION public.delivery_import_secret_ok(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_import_secret_ok(text) TO service_role;
