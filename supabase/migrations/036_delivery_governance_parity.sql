-- Delivery Governance → Dashboard, phase 4: the rest of Governance.
--
--   * Change-request approvals: each approver approves or rejects; when all
--     have approved, delivery_cr_decide() applies the change in one
--     transaction — adds the CR work to the plan, moves the project end,
--     and snapshots a new baseline.
--   * Plan shift: delivery_shift_plan() moves every unfinished task.
--   * Audit trail: delivery_audit, written by triggers on every delivery_*
--     table (Governance's 768 audit events are copied in too).
--   * Document feedback (review comments on a document).
--   * Project summary (AI) and team fields.
--   * Current Projects stays in step: a trigger pushes phases and dates from
--     the plan to pipeline_projects, replacing the governance-sync button.
--   * Daily digest settings.
--
-- Access: 'project-plans' tab, as 033–035. Safe to re-run.

-- ── Columns ───────────────────────────────────────────────────────────────
ALTER TABLE delivery_projects        ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE delivery_projects        ADD COLUMN IF NOT EXISTS summary_at TIMESTAMPTZ;
ALTER TABLE delivery_projects        ADD COLUMN IF NOT EXISTS health TEXT;          -- green | amber | red (from summary)
ALTER TABLE delivery_change_requests ADD COLUMN IF NOT EXISTS requested_by TEXT;
ALTER TABLE delivery_change_requests ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE delivery_change_requests ADD COLUMN IF NOT EXISTS baseline_id TEXT;
ALTER TABLE delivery_documents       ADD COLUMN IF NOT EXISTS generator TEXT;       -- user_stories | test_cases | process_flows | status_report

-- ── Audit trail ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_audit (
  id          TEXT PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  project_id  TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor       TEXT,
  action      TEXT NOT NULL,          -- e.g. task.update, cr.approve
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_delivery_audit_project ON delivery_audit(project_id, at DESC);
ALTER TABLE delivery_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tab: project-plans read" ON delivery_audit;
CREATE POLICY "tab: project-plans read" ON delivery_audit FOR SELECT TO authenticated
  USING (has_tab('project-plans','view'));
-- No insert/update/delete policy: rows come only from the triggers below.

CREATE OR REPLACE FUNCTION delivery_actor() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT u.full_name FROM authorized_users u WHERE lower(u.email) = lower(auth.jwt() ->> 'email') AND u.full_name IS NOT NULL),
    auth.jwt() ->> 'email',
    'system')
$$;

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
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(k ORDER BY k) INTO changed
    FROM jsonb_object_keys(newj) k
    WHERE k NOT IN ('updated_at', 'updated_by') AND newj -> k IS DISTINCT FROM oldj -> k;
    IF changed IS NULL THEN RETURN NULL; END IF;   -- touch-only update
  END IF;
  INSERT INTO delivery_audit (project_id, actor, action, payload)
  VALUES (pid, delivery_actor(), entity || '.' || op,
          jsonb_strip_nulls(jsonb_build_object('id', rowj ->> 'id', 'label', label, 'fields', to_jsonb(changed))));
  RETURN NULL;
END $$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('delivery_projects','project'), ('delivery_tasks','task'), ('delivery_issues','issue'),
    ('delivery_features','heatmap'), ('delivery_checkins','checkin'), ('delivery_change_requests','cr'),
    ('delivery_requests','request'), ('delivery_documents','document')) v(t, e)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON %1$I', r.t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION delivery_audit_row(%2$L)', r.t, r.e);
  END LOOP;
END $$;

-- ── Document feedback ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_document_feedback (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES delivery_documents(id) ON DELETE CASCADE,
  project_id   TEXT NOT NULL REFERENCES delivery_projects(id) ON DELETE CASCADE,
  author       TEXT,
  body         TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'open',    -- open | resolved
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (state IN ('open', 'resolved'))
);
CREATE INDEX IF NOT EXISTS idx_delivery_doc_feedback ON delivery_document_feedback(document_id, created_at);
DROP TRIGGER IF EXISTS trg_delivery_document_feedback_touch ON delivery_document_feedback;
CREATE TRIGGER trg_delivery_document_feedback_touch BEFORE UPDATE ON delivery_document_feedback
  FOR EACH ROW EXECUTE FUNCTION delivery_touch_updated_at();
ALTER TABLE delivery_document_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tab: project-plans" ON delivery_document_feedback;
CREATE POLICY "tab: project-plans" ON delivery_document_feedback FOR ALL TO authenticated
  USING (has_tab('project-plans','view')) WITH CHECK (has_tab('project-plans','edit'));

-- ── People picker ─────────────────────────────────────────────────────────
-- Names and emails of active Dashboard users, for PM / lead / approver
-- pickers. authorized_users itself stays admin-only.
CREATE OR REPLACE FUNCTION delivery_people()
RETURNS TABLE(email TEXT, full_name TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.email, COALESCE(u.full_name, split_part(u.email, '@', 1))
  FROM authorized_users u
  WHERE COALESCE(u.active, true) AND u.email ILIKE '%@simpliigence.com' AND has_tab('project-plans', 'view')
  ORDER BY 2
$$;
REVOKE ALL ON FUNCTION delivery_people() FROM public, anon;
GRANT EXECUTE ON FUNCTION delivery_people() TO authenticated;

-- ── Change-request decisions ──────────────────────────────────────────────
-- Records one approver's decision. When the last approver approves, the CR
-- is applied: a plan task for the work, the project end moves by
-- impact_days, and a baseline is captured. Any rejection rejects the CR.
CREATE OR REPLACE FUNCTION delivery_cr_decide(p_cr_id TEXT, p_idx INT, p_decision TEXT, p_note TEXT DEFAULT NULL)
RETURNS delivery_change_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  cr        delivery_change_requests;
  prj       delivery_projects;
  apps      JSONB;
  who       TEXT := delivery_actor();
  plan_end  DATE;
  new_end   DATE;
  start_d   DATE;
  base_id   TEXT;
  next_sort INT;
BEGIN
  IF NOT has_tab('project-plans', 'edit') THEN
    RAISE EXCEPTION 'You need edit access to Project Plans to record a decision.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected', 'pending') THEN
    RAISE EXCEPTION 'Decision must be approved, rejected or pending.';
  END IF;
  SELECT * INTO cr FROM delivery_change_requests WHERE id = p_cr_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Change request not found.'; END IF;
  IF cr.state <> 'pending' THEN
    RAISE EXCEPTION 'This change request was already %.', cr.state;
  END IF;
  apps := COALESCE(cr.approvers, '[]'::jsonb);
  IF p_idx < 0 OR p_idx >= jsonb_array_length(apps) THEN RAISE EXCEPTION 'No approver at position %.', p_idx; END IF;

  apps := jsonb_set(apps, ARRAY[p_idx::text],
    (apps -> p_idx) || jsonb_strip_nulls(jsonb_build_object(
      'state', p_decision,
      'at', CASE WHEN p_decision = 'pending' THEN NULL ELSE to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') END,
      'by', CASE WHEN p_decision = 'pending' THEN NULL ELSE who END,
      'note', NULLIF(trim(COALESCE(p_note, '')), ''))));
  IF p_decision = 'pending' THEN apps := jsonb_set(apps, ARRAY[p_idx::text], (apps -> p_idx) - 'at' - 'by' - 'note'); END IF;

  UPDATE delivery_change_requests SET approvers = apps WHERE id = p_cr_id RETURNING * INTO cr;

  IF p_decision = 'rejected' THEN
    UPDATE delivery_change_requests SET state = 'rejected', decided_at = now() WHERE id = p_cr_id RETURNING * INTO cr;
    RETURN cr;
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(apps) a WHERE COALESCE(a ->> 'state', 'pending') <> 'approved') THEN
    RETURN cr;   -- still waiting on someone
  END IF;

  -- Everyone approved: apply it.
  SELECT * INTO prj FROM delivery_projects WHERE id = cr.project_id FOR UPDATE;
  SELECT max(end_date) INTO plan_end FROM delivery_tasks WHERE project_id = cr.project_id;
  plan_end := COALESCE(prj.current_end, prj.planned_end, plan_end, current_date);
  new_end  := plan_end + COALESCE(cr.impact_days, 0);
  start_d  := GREATEST(current_date, COALESCE(plan_end - COALESCE(cr.impact_days, 0), current_date));
  SELECT COALESCE(max(sort_order), 0) + 10 INTO next_sort FROM delivery_tasks WHERE project_id = cr.project_id;

  IF NOT EXISTS (SELECT 1 FROM delivery_tasks WHERE cr_id = cr.id) THEN
    INSERT INTO delivery_tasks (id, project_id, name, phase, start_date, end_date, source, cr_id, sort_order, updated_by)
    VALUES (replace(gen_random_uuid()::text, '-', ''), cr.project_id, 'CR: ' || cr.title, 'Change requests',
            start_d, GREATEST(start_d, start_d + GREATEST(COALESCE(cr.impact_days, 1), 1) - 1), 'cr', cr.id, next_sort, who);
  END IF;

  IF COALESCE(cr.impact_days, 0) > 0 THEN
    UPDATE delivery_projects SET current_end = new_end, updated_by = who WHERE id = cr.project_id;
  END IF;

  base_id := replace(gen_random_uuid()::text, '-', '');
  INSERT INTO delivery_baselines (id, project_id, source, cr_id, label, tasks_snapshot, task_count, planned_end)
  SELECT base_id, cr.project_id, 'cr', cr.id, 'After CR: ' || cr.title,
         COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'phase', t.phase, 'start', t.start_date, 'end', t.end_date)
                            ORDER BY t.sort_order), '[]'::jsonb),
         count(*), GREATEST(new_end, COALESCE(max(t.end_date), new_end))
  FROM delivery_tasks t WHERE t.project_id = cr.project_id;

  UPDATE delivery_change_requests SET state = 'approved', decided_at = now(), baseline_id = base_id
  WHERE id = p_cr_id RETURNING * INTO cr;
  RETURN cr;
END $$;
REVOKE ALL ON FUNCTION delivery_cr_decide(TEXT, INT, TEXT, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION delivery_cr_decide(TEXT, INT, TEXT, TEXT) TO authenticated;

-- ── Plan shift ────────────────────────────────────────────────────────────
-- Moves every unfinished task that ends on/after p_from by p_days (negative
-- pulls in), and the project end with it. Returns how many tasks moved.
CREATE OR REPLACE FUNCTION delivery_shift_plan(p_project_id TEXT, p_days INT, p_from DATE DEFAULT NULL, p_move_end BOOLEAN DEFAULT true)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n INT;
BEGIN
  IF NOT has_tab('project-plans', 'edit') THEN
    RAISE EXCEPTION 'You need edit access to Project Plans to shift a plan.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_days = 0 THEN RETURN 0; END IF;
  UPDATE delivery_tasks
     SET start_date = CASE WHEN start_date IS NOT NULL AND (p_from IS NULL OR start_date >= p_from) THEN start_date + p_days ELSE start_date END,
         end_date   = end_date + p_days,
         updated_by = delivery_actor()
   WHERE project_id = p_project_id AND status <> 'done' AND percent < 100
     AND end_date IS NOT NULL AND (p_from IS NULL OR end_date >= p_from);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF p_move_end THEN
    UPDATE delivery_projects SET current_end = COALESCE(current_end, planned_end) + p_days, updated_by = delivery_actor()
     WHERE id = p_project_id AND COALESCE(current_end, planned_end) IS NOT NULL;
  END IF;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION delivery_shift_plan(TEXT, INT, DATE, BOOLEAN) FROM public, anon;
GRANT EXECUTE ON FUNCTION delivery_shift_plan(TEXT, INT, DATE, BOOLEAN) TO authenticated;

-- ── Keep Current Projects in step with the plan ───────────────────────────
-- Same phase model governance-sync produced: tasks grouped by phase label in
-- plan order; a phase is closed only when every task in it is done.
CREATE OR REPLACE FUNCTION delivery_push_to_pipeline(p_project_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  prj    delivery_projects;
  v_phases JSONB;
  v_s DATE; v_e DATE; v_n INT; v_closed INT;
BEGIN
  SELECT * INTO prj FROM delivery_projects WHERE id = p_project_id;
  IF NOT FOUND OR prj.pipeline_project_id IS NULL THEN RETURN; END IF;

  WITH t AS (
    SELECT COALESCE(NULLIF(trim(phase), ''), 'Unphased') AS ph, start_date, end_date,
           (status = 'done' OR percent >= 100) AS done, percent, NULLIF(trim(assignee), '') AS who,
           sort_order, id
    FROM delivery_tasks WHERE project_id = p_project_id
  ), g AS (
    SELECT ph, min(start_date) AS s, max(end_date) AS e, bool_and(done) AS all_done,
           bool_or(percent > 0) AS started,
           CASE WHEN count(DISTINCT who) = 1 THEN max(who) ELSE '' END AS owner,
           min(sort_order) AS first_sort
    FROM t GROUP BY ph
  )
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', 'plan-' || regexp_replace(lower(ph), '[^a-z0-9]+', '-', 'g'),
           'name', ph,
           'startDate', COALESCE(s::text, ''),
           'endDate', COALESCE(e::text, ''),
           'status', CASE WHEN all_done THEN 'Completed' WHEN started THEN 'In Progress' ELSE 'Active' END,
           'isClosed', all_done,
           'completedOn', CASE WHEN all_done THEN e::text END,
           'owner', owner)) ORDER BY first_sort),
         min(s), max(e), count(*), count(*) FILTER (WHERE all_done)
    INTO v_phases, v_s, v_e, v_n, v_closed
  FROM g;

  UPDATE pipeline_projects SET
    phases     = CASE WHEN v_n > 0 THEN v_phases ELSE pipeline_projects.phases END,
    start_date = COALESCE(COALESCE(prj.start_date, v_s)::text, pipeline_projects.start_date),
    end_date   = COALESCE(COALESCE(prj.current_end, prj.planned_end, v_e)::text, pipeline_projects.end_date),
    status     = CASE WHEN prj.status = 'completed' OR (v_n > 0 AND v_closed = v_n) THEN 'Completed' ELSE pipeline_projects.status END,
    governance_project_id = prj.id,
    governance_project_name = prj.name,
    governance_synced_at = now(),
    updated_at = now()
  WHERE id = prj.pipeline_project_id;
END $$;

CREATE OR REPLACE FUNCTION delivery_push_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'delivery_projects' THEN
    PERFORM delivery_push_to_pipeline(COALESCE(NEW.id, OLD.id));
  ELSE
    PERFORM delivery_push_to_pipeline(COALESCE(NEW.project_id, OLD.project_id));
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_delivery_tasks_push ON delivery_tasks;
CREATE TRIGGER trg_delivery_tasks_push AFTER INSERT OR UPDATE OR DELETE ON delivery_tasks
  FOR EACH ROW EXECUTE FUNCTION delivery_push_trigger();
DROP TRIGGER IF EXISTS trg_delivery_projects_push ON delivery_projects;
CREATE TRIGGER trg_delivery_projects_push AFTER UPDATE OF status, start_date, planned_end, current_end, name ON delivery_projects
  FOR EACH ROW EXECUTE FUNCTION delivery_push_trigger();

-- ── Digest settings ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE delivery_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tab: project-plans" ON delivery_settings;
CREATE POLICY "tab: project-plans" ON delivery_settings FOR ALL TO authenticated
  USING (has_tab('project-plans','view')) WITH CHECK (has_tab('project-plans','approve'));
INSERT INTO delivery_settings (key, value) VALUES
  ('digest_enabled', 'true'),                         -- daily PM digest + Monday portfolio digest
  ('digest_cr_stale_days', '3'),                      -- a pending CR older than this is flagged
  ('portfolio_digest_to', 'raghu.seetharam@simpliigence.com')
ON CONFLICT (key) DO NOTHING;

-- ── New project setup ─────────────────────────────────────────────────────
-- Current Projects rows a new plan can be linked to. pipeline_projects is
-- behind the financial 'pipeline' tab, so plan editors get just id, name,
-- status and dates through this function — never revenue or resources.
CREATE OR REPLACE FUNCTION delivery_pipeline_options()
RETURNS TABLE(id TEXT, name TEXT, status TEXT, start_date TEXT, end_date TEXT, linked_to TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.name, p.status, p.start_date, p.end_date, d.id
  FROM pipeline_projects p
  LEFT JOIN delivery_projects d ON d.pipeline_project_id = p.id
  WHERE has_tab('project-plans', 'edit')
  ORDER BY (d.id IS NOT NULL), lower(p.name)
$$;
REVOKE ALL ON FUNCTION delivery_pipeline_options() FROM public, anon;
GRANT EXECUTE ON FUNCTION delivery_pipeline_options() TO authenticated;

-- ── Daily digest schedule ─────────────────────────────────────────────────
-- pg_cron calls delivery-digest at 12:30 UTC (08:30 New York, 18:00 India).
-- The function checks X-Cron-Secret against the vault secret below; only
-- service_role can run the check.
CREATE OR REPLACE FUNCTION public.delivery_cron_secret_ok(p_secret text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets
                 WHERE name = 'DELIVERY_CRON_SECRET' AND decrypted_secret = p_secret)
$$;
REVOKE ALL ON FUNCTION public.delivery_cron_secret_ok(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_cron_secret_ok(text) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'DELIVERY_CRON_SECRET') THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'DELIVERY_CRON_SECRET', 'delivery-digest: pg_cron caller secret');
  END IF;
  PERFORM cron.unschedule('delivery-digest') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'delivery-digest');
  PERFORM cron.schedule('delivery-digest', '30 12 * * *', $cron$
    SELECT net.http_post(
      url := 'https://mhmxlubithnidopmkwgt.supabase.co/functions/v1/delivery-digest',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_KEY'),
        'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'DELIVERY_CRON_SECRET')),
      body := '{"fromCron": true}'::jsonb, timeout_milliseconds := 60000)
  $cron$);
EXCEPTION WHEN undefined_function OR undefined_table OR invalid_schema_name THEN
  RAISE NOTICE 'pg_cron / vault not available here — schedule delivery-digest manually.';
END $$;

-- ── Data: Governance's 7 document review comments ─────────────────────────
INSERT INTO delivery_document_feedback (id, document_id, project_id, author, body, state, created_at)
SELECT v.id, v.doc, d.project_id, 'Anupama Bavihalli', v.body, 'resolved', v.at::timestamptz
FROM (VALUES
  ('27ffeaa60ddb484e','ef7ebe6c9af94624','2026-05-18 10:03:00Z','Account Legl Name is the field to hold the name of the account, Additionally sales rep can enter Operating name for the account.,'),
  ('412b86ce68ce418a','ef7ebe6c9af94624','2026-05-18 10:05:55Z','360 of account will include - Contacts , Opportunity , Contracts, Orders'),
  ('6f281f3b3e484b68','ef7ebe6c9af94624','2026-05-18 10:05:31Z','MAL Id is unique for all account and its auto generated, Parent and child accounts will share same DUNS number.'),
  ('8d28dfacba4846f6','ef7ebe6c9af94624','2026-05-18 10:04:10Z','Contact creation is done post the account creation, Add contact relationship with the account and select the role they play, same contact can have different email address and play different role for different accounts.'),
  ('9db51132e8b14132','ef7ebe6c9af94624','2026-05-18 10:02:14Z','In this project the decision is not use record type for any records. Please remove record type everywhere'),
  ('b615cbf1b8da4ecb','ef7ebe6c9af94624','2026-05-18 10:07:02Z','remove test case- TC-010: Region Does Not Auto-Assign Account Owner'),
  ('46af35f1b2754a14','46f4e176b433469f','2026-05-18 10:11:27Z','there is no duplication rule on DUNS Number , both parent and child can have same DUNS')
) v(id, doc, at, body)
JOIN delivery_documents d ON d.id = v.doc
ON CONFLICT (id) DO NOTHING;

-- Governance's AI-generated documents join the regenerate chain.
UPDATE delivery_documents SET generator = CASE doc_type
    WHEN 'User Stories' THEN 'user_stories' WHEN 'Test Cases' THEN 'test_cases'
    WHEN 'Process Flows' THEN 'process_flows' WHEN 'Status Report' THEN 'status_report' END
WHERE source = 'generated' AND generator IS NULL
  AND doc_type IN ('User Stories', 'Test Cases', 'Process Flows', 'Status Report');
