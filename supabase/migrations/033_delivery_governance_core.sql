-- Delivery Governance → Dashboard, phase 1: project plans, tasks, baselines,
-- change requests and issues.
--
-- Until now these lived in the separate Delivery Governance app (FastAPI +
-- its own Postgres on Render) and reached the Dashboard only through the
-- governance-sync edge function, which collapsed tasks into phases and needed
-- a human to match project names across the two systems. This migration gives
-- them a home here so the plan is edited where the team, allocation and
-- financials already live, and the sync can be retired.
--
-- Design notes
--  * delivery_projects is its own table rather than more columns on
--    pipeline_projects. pipeline_projects is gated by the financial 'pipeline'
--    tab (revenue, resources); PMs and BAs who own plans must not need that
--    access just to see a project name. The two are linked 1:1 through
--    pipeline_project_id.
--  * Migrated rows keep their Governance ids, so the copy script is
--    idempotent (upsert on id) and any link pasted from Governance can be
--    traced. New rows get a nanoid from the client.
--  * Dates are DATE here. Governance stored them as strings where '' meant
--    "not set"; the copy script maps '' to NULL.
--  * Access follows the Dashboard's tab model: one new tab, 'project-plans',
--    read with has_tab(..,'view') and written with has_tab(..,'edit').
--
-- Safe to re-run: everything is IF NOT EXISTS / ON CONFLICT.

-- ── Tables ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS delivery_projects (
  id                   TEXT PRIMARY KEY,
  pipeline_project_id  TEXT UNIQUE REFERENCES pipeline_projects(id) ON DELETE SET NULL,
  name                 TEXT NOT NULL,
  client               TEXT,
  sow_id               TEXT,
  template             TEXT,
  status               TEXT NOT NULL DEFAULT 'active',   -- active | completed | on_hold | cancelled
  start_date           DATE,
  planned_end          DATE,                              -- baseline end
  current_end          DATE,                              -- live end (what the dashboard shows)
  pm                   TEXT,
  delivery_lead        TEXT,
  architect            TEXT,
  sponsor              TEXT,
  frozen_requirements  JSONB NOT NULL DEFAULT '[]'::jsonb,
  frozen_exclusions    JSONB NOT NULL DEFAULT '[]'::jsonb,
  sharepoint_site_id   TEXT,
  sharepoint_folder    TEXT,
  teams_channel_id     TEXT,
  zoho_project_id      TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           TEXT
);

CREATE TABLE IF NOT EXISTS delivery_tasks (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES delivery_projects(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES delivery_tasks(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phase       TEXT,                                   -- label; the dashboard groups tasks by it
  start_date  DATE,
  end_date    DATE,
  percent     INTEGER NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  status      TEXT NOT NULL DEFAULT 'task',           -- task | done  (Governance's two states)
  source      TEXT NOT NULL DEFAULT 'manual',         -- manual | sow | cr
  cr_id       TEXT,                                   -- change request that added it, if any
  depends_on  JSONB NOT NULL DEFAULT '[]'::jsonb,
  assignee    TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  external_id TEXT,                                   -- Zoho task id, when imported
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);

-- Snapshot of the plan at a point in time (initial plan, or after an approved
-- change request). Read-only history; never edited after insert.
CREATE TABLE IF NOT EXISTS delivery_baselines (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES delivery_projects(id) ON DELETE CASCADE,
  snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  source          TEXT NOT NULL DEFAULT 'initial',    -- initial | cr
  cr_id           TEXT,
  label           TEXT,
  tasks_snapshot  JSONB NOT NULL DEFAULT '[]'::jsonb,
  task_count      INTEGER NOT NULL DEFAULT 0,
  planned_end     DATE
);

CREATE TABLE IF NOT EXISTS delivery_change_requests (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES delivery_projects(id) ON DELETE CASCADE,
  request_id       TEXT,                              -- client request it came from (phase 3 table)
  title            TEXT NOT NULL,
  description      TEXT,
  impact_days      INTEGER,
  impact_hours     INTEGER,
  milestone_shift  TEXT,
  approvers        JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{role, who, state, at}]
  state            TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_issues (
  id                       TEXT PRIMARY KEY,
  project_id               TEXT NOT NULL REFERENCES delivery_projects(id) ON DELETE CASCADE,
  description              TEXT NOT NULL,
  owner                    TEXT,
  due_date                 DATE,
  criticality              TEXT NOT NULL DEFAULT 'medium', -- low | medium | high | critical
  impact                   TEXT,
  state                    TEXT NOT NULL DEFAULT 'open',   -- open | closed
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at                TIMESTAMPTZ,
  created_from_checkin_id  TEXT,
  created_by               TEXT,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_tasks_project      ON delivery_tasks(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_delivery_baselines_project  ON delivery_baselines(project_id, snapshot_at);
CREATE INDEX IF NOT EXISTS idx_delivery_crs_project        ON delivery_change_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_delivery_issues_project     ON delivery_issues(project_id, state);

-- ── updated_at maintenance ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION delivery_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['delivery_projects','delivery_tasks','delivery_change_requests','delivery_issues'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_touch ON %1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_touch BEFORE UPDATE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION delivery_touch_updated_at()', t);
  END LOOP;
END $$;

-- ── Access: the 'project-plans' tab ───────────────────────────────────────

INSERT INTO app_tabs (tab_key, label, section, sort_order, is_financial, active)
VALUES ('project-plans', 'Project Plans', 'Delivery', 95, false, true)
ON CONFLICT (tab_key) DO NOTHING;

-- Admins and managers can view and edit plans. Employees (BAs, project leads)
-- get it per person through user_tab_permissions — see the copy script, which
-- grants it to everyone who had a Governance login.
INSERT INTO role_tab_permissions (role, tab_key, can_view, can_edit, can_approve)
VALUES ('admin',   'project-plans', true, true, true),
       ('manager', 'project-plans', true, true, false)
ON CONFLICT (role, tab_key) DO NOTHING;

ALTER TABLE delivery_projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_tasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_baselines       ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_issues          ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['delivery_projects','delivery_tasks','delivery_change_requests','delivery_issues'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "tab: project-plans" ON %I', t);
    EXECUTE format($p$CREATE POLICY "tab: project-plans" ON %I FOR ALL TO authenticated
                      USING (has_tab('project-plans','view'))
                      WITH CHECK (has_tab('project-plans','edit'))$p$, t);
  END LOOP;
END $$;

-- Baselines are history: readable by plan viewers, insertable by editors,
-- never updated or deleted from the app.
DROP POLICY IF EXISTS "tab: project-plans read"   ON delivery_baselines;
DROP POLICY IF EXISTS "tab: project-plans insert" ON delivery_baselines;
CREATE POLICY "tab: project-plans read" ON delivery_baselines FOR SELECT TO authenticated
  USING (has_tab('project-plans','view'));
CREATE POLICY "tab: project-plans insert" ON delivery_baselines FOR INSERT TO authenticated
  WITH CHECK (has_tab('project-plans','edit'));
