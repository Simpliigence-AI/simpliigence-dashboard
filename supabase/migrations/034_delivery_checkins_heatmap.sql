-- Delivery Governance → Dashboard, phase 2: weekly check-ins (status
-- reports) and the feature heatmap. Builds on 033.
--
-- Weekly check-in
--   A PM's weekly status for one project. Governance auto-created an empty
--   draft every week; of 74 rows at migration time only 7 were submitted and
--   67 were empty drafts, so the copy script skips empty drafts. On submit,
--   the plan, heatmap and open issues ("parking lot") are frozen into the
--   *_snapshot columns so a past report always shows what was true that week,
--   not what is true now.
--
-- Feature heatmap
--   The list of features/modules in scope, each with a build state and a
--   demo state. It's what clients see in reviews: "what's built, what's been
--   shown to us".
--
-- Access: same 'project-plans' tab as 033. Safe to re-run.

CREATE TABLE IF NOT EXISTS delivery_checkins (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES delivery_projects(id) ON DELETE CASCADE,
  week_ending           DATE NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft',      -- draft | submitted
  activities_build      TEXT,
  activities_testing    TEXT,
  activities_demos      TEXT,
  activities_pm         TEXT,
  upcoming_focus        TEXT,
  plan_snapshot         JSONB NOT NULL DEFAULT '[]'::jsonb, -- delivery_tasks as of submit
  heatmap_snapshot      JSONB NOT NULL DEFAULT '[]'::jsonb, -- delivery_features as of submit
  parking_lot_snapshot  JSONB NOT NULL DEFAULT '[]'::jsonb, -- open delivery_issues as of submit
  submitted_at          TIMESTAMPTZ,
  submitted_by          TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('draft', 'submitted')),
  CHECK (status = 'draft' OR submitted_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS delivery_features (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES delivery_projects(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  completion_state  TEXT NOT NULL DEFAULT 'not_started',  -- not_started | partial | complete
  demo_state        TEXT NOT NULL DEFAULT 'not_demoed',   -- not_demoed | demoed
  order_index       INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (completion_state IN ('not_started', 'partial', 'complete')),
  CHECK (demo_state IN ('not_demoed', 'demoed'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_checkins_project ON delivery_checkins(project_id, week_ending DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_features_project ON delivery_features(project_id, order_index);

-- One open draft per project per week. Governance allowed duplicates (three
-- rows for the same week on one project); submitted history keeps them, but
-- new drafts can't pile up.
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_checkins_one_draft
  ON delivery_checkins(project_id, week_ending) WHERE status = 'draft';

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['delivery_checkins','delivery_features'] LOOP
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

-- A submitted report is a record of what was said that week. It can't be
-- edited back into a draft or changed after the fact from the app.
CREATE OR REPLACE FUNCTION delivery_checkin_lock()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status = 'submitted' THEN
    RAISE EXCEPTION 'This check-in was submitted on % and can no longer be changed.', OLD.submitted_at::date
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_delivery_checkins_lock ON delivery_checkins;
CREATE TRIGGER trg_delivery_checkins_lock BEFORE UPDATE ON delivery_checkins
  FOR EACH ROW EXECUTE FUNCTION delivery_checkin_lock();
