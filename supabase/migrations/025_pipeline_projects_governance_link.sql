-- Link pipeline projects to their counterpart in the Delivery Governance tool.
--
-- The two systems name the same engagement differently and either side can be
-- renamed independently, so the match is confirmed by a human once (in the
-- "Sync with Delivery Governance" dialog on /projects) and then stored here.
-- Re-matching on names at every sync would silently re-point a project at the
-- wrong plan the first time somebody renames something.
--
-- governance_project_name is denormalised on purpose: it lets the sync dialog
-- show what a project is currently linked to without a round-trip to
-- Governance, which matters because that service is on Render's free tier and
-- can take ~50s to wake from cold.
--
-- Nothing here is authoritative — it can all be rebuilt by re-running the
-- sync — so no NOT NULL and no FK (the referenced ids live in another
-- system's database entirely).

ALTER TABLE pipeline_projects
  ADD COLUMN IF NOT EXISTS governance_project_id   TEXT,
  ADD COLUMN IF NOT EXISTS governance_project_name TEXT,
  ADD COLUMN IF NOT EXISTS governance_synced_at    TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pipeline_projects_governance
  ON pipeline_projects(governance_project_id);
