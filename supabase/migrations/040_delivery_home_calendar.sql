-- 040 — Delivery Home + project calendar
--
-- Delivery Home (/delivery-home) reads two views:
--   v_delivery_home_projects  one row per current project with every signal the page flags
--   v_delivery_pod_util       pod booking % for each month touching the next 60 days
-- The project calendar is fed by the `delivery-calendar` edge function, which reads the
-- Outlook calendars of the delivery managers (Sujatha, Anupama) and every allocated team
-- member through Microsoft Graph and hands each mailbox's events to
-- delivery_calendar_ingest(). Matching an invite to a project happens here, in SQL, so it
-- can be re-run whenever keywords change.
--
-- Both views are SECURITY DEFINER on purpose (they read forecast_assignments and
-- project_team_pods, which a Project Plans user may have no grant on) and carry their
-- own has_tab('project-plans','view') filter. They expose hours only — no rates or cost.

-- ── Calendar storage ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS delivery_calendar_mailboxes (
  email          text PRIMARY KEY,
  name           text,
  kind           text NOT NULL DEFAULT 'team' CHECK (kind IN ('core','team')),  -- core = always read (delivery managers)
  active         boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  last_error     text,
  event_count    integer,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO delivery_calendar_mailboxes (email, name, kind) VALUES
  ('sujatha.neelakannan@simpliigence.com', 'Sujatha Neelakannan', 'core'),
  ('anupama.b@simpliigence.com',           'Anupama Bavihalli',   'core')
ON CONFLICT (email) DO UPDATE SET kind = 'core', active = true;

CREATE TABLE IF NOT EXISTS delivery_calendar_events (
  id             text PRIMARY KEY,                 -- iCalUId (+ occurrence start for recurring series)
  subject        text,
  start_at       timestamptz NOT NULL,
  end_at         timestamptz NOT NULL,
  is_all_day     boolean NOT NULL DEFAULT false,
  is_cancelled   boolean NOT NULL DEFAULT false,
  organizer      text,                             -- email
  organizer_name text,
  attendees      jsonb NOT NULL DEFAULT '[]',      -- [{email,name,response}]
  mailboxes      text[] NOT NULL DEFAULT '{}',     -- whose calendars carry it
  join_url       text,
  web_link       text,
  location       text,
  is_external    boolean NOT NULL DEFAULT false,   -- any attendee outside simpliigence.com
  project_id     text REFERENCES delivery_projects(id) ON DELETE SET NULL,
  match_source   text CHECK (match_source IN ('auto','manual','ignored')),
  match_reason   text,
  synced_at      timestamptz NOT NULL DEFAULT now(),
  updated_by     text
);
CREATE INDEX IF NOT EXISTS delivery_calendar_events_start ON delivery_calendar_events (start_at);
CREATE INDEX IF NOT EXISTS delivery_calendar_events_project ON delivery_calendar_events (project_id, start_at);

-- Per-project matching hints. client_domains grows on its own: tagging an invite by hand
-- teaches the project that invite's external attendee domains.
ALTER TABLE delivery_projects ADD COLUMN IF NOT EXISTS calendar_keywords text[] NOT NULL DEFAULT '{}';
ALTER TABLE delivery_projects ADD COLUMN IF NOT EXISTS client_domains    text[] NOT NULL DEFAULT '{}';

ALTER TABLE delivery_calendar_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_calendar_mailboxes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tab: project-plans" ON delivery_calendar_events;
CREATE POLICY "tab: project-plans" ON delivery_calendar_events FOR SELECT TO authenticated USING (has_tab('project-plans','view'));
DROP POLICY IF EXISTS "tab: project-plans" ON delivery_calendar_mailboxes;
CREATE POLICY "tab: project-plans" ON delivery_calendar_mailboxes FOR SELECT TO authenticated USING (has_tab('project-plans','view'));
REVOKE ALL ON delivery_calendar_events, delivery_calendar_mailboxes FROM anon;
GRANT SELECT ON delivery_calendar_events, delivery_calendar_mailboxes TO authenticated;

-- ── Matching ────────────────────────────────────────────────────────────

-- Best project for one event, or null. Scores: project name in subject 4, own keyword 4,
-- client name in subject 2, a client domain among the attendees 3. A tie between two
-- projects stays untagged (three Copeland projects share one client) — better unmatched
-- than wrong; it lands in "Untagged" for a human.
CREATE OR REPLACE FUNCTION delivery_calendar_best_match(p_subject text, p_attendees jsonb, OUT project_id text, OUT reason text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH doms AS (
    SELECT DISTINCT lower(split_part(a->>'email','@',2)) d FROM jsonb_array_elements(coalesce(p_attendees,'[]')) a
    WHERE a->>'email' LIKE '%@%' AND lower(a->>'email') NOT LIKE '%@simpliigence.com'
  ), s AS (
    SELECT dp.id,
      (CASE WHEN length(dp.name) >= 4 AND p_subject ILIKE '%' || dp.name || '%' THEN 4 ELSE 0 END)
      + (CASE WHEN EXISTS (SELECT 1 FROM unnest(dp.calendar_keywords) k WHERE length(k) >= 3 AND p_subject ILIKE '%' || k || '%') THEN 4 ELSE 0 END)
      + (CASE WHEN length(coalesce(dp.client,'')) >= 4 AND p_subject ILIKE '%' || split_part(dp.client,' - ',1) || '%' THEN 2 ELSE 0 END)
      + (CASE WHEN EXISTS (SELECT 1 FROM doms WHERE doms.d = ANY (dp.client_domains)) THEN 3 ELSE 0 END) AS score,
      concat_ws(', ',
        CASE WHEN length(dp.name) >= 4 AND p_subject ILIKE '%' || dp.name || '%' THEN 'project name in subject' END,
        CASE WHEN EXISTS (SELECT 1 FROM unnest(dp.calendar_keywords) k WHERE length(k) >= 3 AND p_subject ILIKE '%' || k || '%') THEN 'keyword in subject' END,
        CASE WHEN length(coalesce(dp.client,'')) >= 4 AND p_subject ILIKE '%' || split_part(dp.client,' - ',1) || '%' THEN 'client name in subject' END,
        CASE WHEN EXISTS (SELECT 1 FROM doms WHERE doms.d = ANY (dp.client_domains)) THEN 'client attendee' END) AS why
    FROM delivery_projects dp WHERE dp.status IN ('active','on_hold')
  ), ranked AS (
    SELECT id, why, score, rank() OVER (ORDER BY score DESC) r, count(*) OVER (PARTITION BY score) n FROM s WHERE score > 0
  )
  SELECT id, why FROM ranked WHERE r = 1 AND n = 1
$$;

-- Re-match every event that a person has not decided on.
CREATE OR REPLACE FUNCTION delivery_calendar_rematch() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE delivery_calendar_events e SET project_id = m.project_id, match_reason = m.reason,
         match_source = CASE WHEN m.project_id IS NULL THEN NULL ELSE 'auto' END
  FROM delivery_calendar_events e2 LEFT JOIN LATERAL delivery_calendar_best_match(e2.subject, e2.attendees) m ON true
  WHERE e.id = e2.id AND coalesce(e.match_source,'auto') = 'auto'
    AND (e.project_id IS DISTINCT FROM m.project_id OR e.match_reason IS DISTINCT FROM m.reason);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- One mailbox's events for a window, from the edge function (service role only).
-- Upserts what came back, removes this mailbox from events it no longer carries, deletes
-- events no mailbox carries, then matches.
CREATE OR REPLACE FUNCTION delivery_calendar_ingest(p_mailbox text, p_from timestamptz, p_to timestamptz, p_events jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE mb text := lower(p_mailbox); ids text[]; n_in integer; n_gone integer;
BEGIN
  SELECT coalesce(array_agg(x->>'id'), '{}') INTO ids FROM jsonb_array_elements(p_events) x;
  n_in := coalesce(array_length(ids,1),0);

  INSERT INTO delivery_calendar_events AS e (id, subject, start_at, end_at, is_all_day, is_cancelled, organizer, organizer_name,
         attendees, mailboxes, join_url, web_link, location, is_external, synced_at)
  SELECT x->>'id', x->>'subject', (x->>'start')::timestamptz, (x->>'end')::timestamptz, coalesce((x->>'allDay')::boolean,false),
         coalesce((x->>'cancelled')::boolean,false), lower(x->>'organizer'), x->>'organizerName', coalesce(x->'attendees','[]'),
         ARRAY[mb], x->>'joinUrl', x->>'webLink', x->>'location',
         EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(x->'attendees','[]')) a
                 WHERE a->>'email' LIKE '%@%' AND lower(a->>'email') NOT LIKE '%@simpliigence.com'), now()
  FROM jsonb_array_elements(p_events) x
  ON CONFLICT (id) DO UPDATE SET subject = excluded.subject, start_at = excluded.start_at, end_at = excluded.end_at,
         is_all_day = excluded.is_all_day, is_cancelled = excluded.is_cancelled, organizer = excluded.organizer,
         organizer_name = excluded.organizer_name, attendees = excluded.attendees, join_url = excluded.join_url,
         web_link = coalesce(e.web_link, excluded.web_link), location = excluded.location, is_external = excluded.is_external,
         mailboxes = CASE WHEN mb = ANY (e.mailboxes) THEN e.mailboxes ELSE e.mailboxes || mb END, synced_at = now();

  UPDATE delivery_calendar_events SET mailboxes = array_remove(mailboxes, mb)
  WHERE mb = ANY (mailboxes) AND start_at >= p_from AND start_at < p_to AND NOT (id = ANY (ids));
  DELETE FROM delivery_calendar_events WHERE cardinality(mailboxes) = 0;
  GET DIAGNOSTICS n_gone = ROW_COUNT;

  PERFORM delivery_calendar_rematch();
  UPDATE delivery_calendar_mailboxes SET last_synced_at = now(), last_error = NULL, event_count = n_in, updated_at = now() WHERE email = mb;
  RETURN jsonb_build_object('mailbox', mb, 'events', n_in, 'removed', n_gone);
END $$;
REVOKE ALL ON FUNCTION delivery_calendar_ingest(text,timestamptz,timestamptz,jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION delivery_calendar_rematch() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION delivery_calendar_ingest(text,timestamptz,timestamptz,jsonb), delivery_calendar_rematch() TO service_role;

-- Tag / untag / ignore an invite by hand. Manual beats auto and is never re-matched.
-- Tagging also teaches the project the invite's client domains.
CREATE OR REPLACE FUNCTION delivery_calendar_tag(p_event_id text, p_project_id text, p_ignore boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE att jsonb;
BEGIN
  IF NOT has_tab('project-plans','edit') THEN RAISE EXCEPTION 'You need edit access to Project Plans.' USING errcode = '42501'; END IF;
  UPDATE delivery_calendar_events SET
    project_id   = CASE WHEN p_ignore THEN NULL ELSE p_project_id END,
    match_source = CASE WHEN p_ignore THEN 'ignored' WHEN p_project_id IS NULL THEN NULL ELSE 'manual' END,
    match_reason = CASE WHEN p_ignore THEN 'not a project meeting' WHEN p_project_id IS NULL THEN NULL ELSE 'tagged by ' || delivery_actor() END,
    updated_by   = delivery_actor()
  WHERE id = p_event_id RETURNING attendees INTO att;
  IF p_project_id IS NOT NULL AND NOT p_ignore THEN
    UPDATE delivery_projects dp SET client_domains = (
      SELECT coalesce(array_agg(DISTINCT d), '{}') FROM (
        SELECT unnest(dp.client_domains) d
        UNION SELECT lower(split_part(a->>'email','@',2)) FROM jsonb_array_elements(coalesce(att,'[]')) a
        WHERE a->>'email' LIKE '%@%' AND lower(a->>'email') NOT LIKE '%@simpliigence.com'
          AND lower(split_part(a->>'email','@',2)) NOT IN ('gmail.com','outlook.com','hotmail.com','yahoo.com','icloud.com','live.com')) z)
    WHERE dp.id = p_project_id;
  END IF;
  IF p_project_id IS NULL AND NOT p_ignore THEN
    UPDATE delivery_calendar_events e SET project_id = m.project_id, match_reason = m.reason,
           match_source = CASE WHEN m.project_id IS NULL THEN NULL ELSE 'auto' END
    FROM delivery_calendar_best_match((SELECT subject FROM delivery_calendar_events WHERE id = p_event_id), att) m
    WHERE e.id = p_event_id;
  END IF;
END $$;

-- Save a project's keywords and re-match.
CREATE OR REPLACE FUNCTION delivery_calendar_set_keywords(p_project_id text, p_keywords text[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT has_tab('project-plans','edit') THEN RAISE EXCEPTION 'You need edit access to Project Plans.' USING errcode = '42501'; END IF;
  UPDATE delivery_projects SET calendar_keywords = (SELECT coalesce(array_agg(DISTINCT btrim(k)), '{}') FROM unnest(p_keywords) k WHERE btrim(k) <> '')
  WHERE id = p_project_id;
  RETURN delivery_calendar_rematch();
END $$;
REVOKE ALL ON FUNCTION delivery_calendar_tag(text,text,boolean), delivery_calendar_set_keywords(text,text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION delivery_calendar_tag(text,text,boolean), delivery_calendar_set_keywords(text,text[]) TO authenticated;

-- ── Delivery Home: per-project signals ──────────────────────────────────

CREATE OR REPLACE VIEW v_delivery_home_projects WITH (security_invoker = false) AS
WITH pp AS (
  SELECT p.*, coalesce(nullif(btrim(p.forecast_name),''), p.name) AS fname
  FROM pipeline_projects p
  WHERE btrim(coalesce(p.status,'')) NOT IN ('Archived','Completed','Proposed','Trashed')
    AND p.name !~* '^(presales|internal)'
), base AS (
  SELECT pp.id AS pipeline_id, dp.id AS plan_id, pp.name, coalesce(dp.client, pp.name) AS client,
         coalesce(nullif(dp.pm,''), pp.owner) AS owner, pp.status, dp.health, pp.fname, pp.phases, dp.planned_end,
         coalesce(safe_ts(pp.start_date)::date, dp.start_date,
                  (SELECT min(t.start_date) FROM delivery_tasks t WHERE t.project_id = dp.id)) AS start_date,
         coalesce(safe_ts(pp.end_date)::date, safe_ts(pp.go_live_date)::date, dp.current_end, dp.planned_end,
                  (SELECT max(t.end_date) FROM delivery_tasks t WHERE t.project_id = dp.id),
                  (SELECT max(safe_ts(e->>'endDate')::date) FROM jsonb_array_elements(coalesce(pp.phases,'[]')) e WHERE e->>'name' <> 'Unphased')) AS end_date,
         safe_ts(pp.go_live_date)::date AS go_live, dp.current_end
  FROM pp LEFT JOIN delivery_projects dp ON dp.pipeline_project_id = pp.id
),
-- Allocation, month by month across the project window. forecast_assignments keys months
-- by abbreviation with no year, so only this calendar year's months can be read.
win AS (
  SELECT b.pipeline_id, m::date AS mon
  FROM base b
  CROSS JOIN LATERAL generate_series(
    date_trunc('month', greatest(coalesce(b.start_date, current_date), date_trunc('year', current_date)::date)),
    date_trunc('month', least(coalesce(b.end_date, current_date + 60), (date_trunc('year', current_date) + interval '11 months')::date)),
    interval '1 month') m
), alloc AS (
  SELECT w.pipeline_id, w.mon,
         coalesce(sum((fa.monthly_totals ->> to_char(w.mon,'Mon'))::numeric), 0) AS hours,
         count(DISTINCT fa.employee_name) FILTER (WHERE (fa.monthly_totals ->> to_char(w.mon,'Mon'))::numeric > 0) AS people
  FROM win w JOIN base b USING (pipeline_id)
  LEFT JOIN forecast_assignments fa ON lower(btrim(fa.project)) = lower(btrim(b.fname))
  GROUP BY 1,2
), alloc_sum AS (
  SELECT pipeline_id, count(*) AS window_months, sum(hours) AS hours,
         coalesce(array_agg(to_char(mon,'Mon') ORDER BY mon) FILTER (WHERE hours = 0), '{}') AS unstaffed_months,
         max(people) AS peak_people
  FROM alloc GROUP BY 1
), team AS (
  SELECT b.pipeline_id, count(DISTINCT fa.employee_name) AS team_size
  FROM base b JOIN forecast_assignments fa ON lower(btrim(fa.project)) = lower(btrim(b.fname)) GROUP BY 1
),
-- Requirements / design per the plan: tasks in a discovery / requirements / design phase,
-- or the same phases in Governance.
rd AS (
  SELECT b.pipeline_id,
         count(t.*) AS rd_tasks,
         bool_and(t.percent >= 100) AS rd_all_done,
         max(t.end_date) AS rd_end,
         (SELECT bool_and(coalesce((e->>'isClosed')::boolean,false) OR safe_ts(e->>'endDate')::date < current_date)
            FROM jsonb_array_elements(coalesce(b.phases,'[]')) e WHERE e->>'name' ~* 'discover|requirement|design|onboard') AS gov_rd_done
  FROM base b LEFT JOIN delivery_tasks t ON t.project_id = b.plan_id AND coalesce(t.phase, t.name) ~* 'discover|requirement|design|\mBRD\M|\mFRD\M'
  GROUP BY b.pipeline_id, b.phases
), docs AS (
  SELECT b.pipeline_id,
         count(*) FILTER (WHERE d.doc_type = 'Requirements') AS n_req,
         count(*) FILTER (WHERE d.doc_type IN ('Design','Process Flows')) AS n_design,
         count(*) FILTER (WHERE d.doc_type = 'User Stories') AS n_stories,
         count(*) FILTER (WHERE d.doc_type = 'Meeting' AND coalesce(d.modified_at, d.created_at) >= now() - interval '14 days') AS rec_14d,
         max(coalesce(d.modified_at, d.created_at)) FILTER (WHERE d.doc_type = 'Meeting') AS last_recording_at
  FROM base b LEFT JOIN delivery_documents d ON d.project_id = b.plan_id GROUP BY 1
), cal AS (
  SELECT b.pipeline_id,
         count(*) FILTER (WHERE e.end_at < now() AND e.end_at >= now() - interval '14 days') AS held_14d,
         max(e.end_at) FILTER (WHERE e.end_at < now()) AS last_held_at,
         min(e.start_at) FILTER (WHERE e.start_at >= now()) AS next_meeting_at,
         count(*) FILTER (WHERE e.start_at >= now() AND e.start_at < now() + interval '14 days') AS upcoming_14d
  FROM base b LEFT JOIN delivery_calendar_events e ON e.project_id = b.plan_id AND NOT e.is_cancelled GROUP BY 1
), iss AS (
  SELECT b.pipeline_id,
         count(i.*) FILTER (WHERE i.state = 'open') AS open_issues,
         count(i.*) FILTER (WHERE i.state = 'open' AND i.due_date < current_date) AS overdue_issues,
         count(i.*) FILTER (WHERE i.state = 'open' AND (i.due_date IS NULL OR nullif(btrim(i.owner),'') IS NULL)) AS unowned_issues,
         count(i.*) FILTER (WHERE i.state = 'open' AND i.criticality IN ('critical','high')) AS severe_issues
  FROM base b LEFT JOIN delivery_issues i ON i.project_id = b.plan_id GROUP BY 1
), late AS (
  SELECT b.pipeline_id,
         (SELECT count(*) FROM jsonb_array_elements(coalesce(b.phases,'[]')) e
           WHERE NOT coalesce((e->>'isClosed')::boolean,false) AND safe_ts(e->>'endDate')::date < current_date) AS late_phases,
         (SELECT count(*) FROM delivery_tasks t WHERE t.project_id = b.plan_id AND t.percent < 100 AND t.end_date < current_date
            AND NOT EXISTS (SELECT 1 FROM delivery_tasks c WHERE c.parent_id = t.id)) AS late_tasks
  FROM base b
)
SELECT b.pipeline_id, b.plan_id, b.name, b.client, b.owner, b.status, b.health, b.start_date, b.end_date, b.go_live,
       coalesce(a.window_months,0) AS window_months, coalesce(a.hours,0) AS allocated_hours, coalesce(tm.team_size,0) AS team_size,
       coalesce(a.unstaffed_months,'{}') AS unstaffed_months,
       CASE WHEN coalesce(tm.team_size,0) = 0 OR coalesce(a.hours,0) = 0 THEN 'none'
            WHEN cardinality(coalesce(a.unstaffed_months,'{}')) > 0 THEN 'gaps' ELSE 'ok' END AS alloc_state,
       coalesce(dc.n_req,0) AS n_requirements, coalesce(dc.n_design,0) AS n_design, coalesce(dc.n_stories,0) AS n_user_stories,
       coalesce(r.rd_tasks,0) AS rd_tasks,
       coalesce(r.rd_all_done OR r.rd_end < current_date OR r.gov_rd_done, false) AS rd_done_per_plan,
       array_remove(ARRAY[
         CASE WHEN coalesce(dc.n_req,0) = 0 THEN 'Requirements' END,
         CASE WHEN coalesce(dc.n_design,0) = 0 THEN 'Design' END,
         CASE WHEN coalesce(dc.n_stories,0) = 0 THEN 'User stories' END], NULL) AS missing_docs,
       -- Flag when the plan says requirements / design are done (or should be), but the artefacts aren't uploaded.
       (coalesce(r.rd_all_done OR r.rd_end < current_date OR r.gov_rd_done
                 OR (coalesce(r.rd_tasks,0) = 0 AND b.start_date < current_date - 30), false)
        AND (coalesce(dc.n_req,0) = 0 OR coalesce(dc.n_design,0) = 0 OR coalesce(dc.n_stories,0) = 0)) AS doc_gap,
       coalesce(dc.rec_14d,0) AS recordings_14d, dc.last_recording_at,
       coalesce(c.held_14d,0) AS meetings_held_14d, c.last_held_at, c.next_meeting_at, coalesce(c.upcoming_14d,0) AS upcoming_14d,
       greatest(dc.last_recording_at, c.last_held_at) AS last_touch_at,
       (coalesce(dc.rec_14d,0) = 0 OR coalesce(c.upcoming_14d,0) = 0) AS cadence_gap,
       coalesce(i.open_issues,0) AS open_issues, coalesce(i.overdue_issues,0) AS overdue_issues,
       coalesce(i.unowned_issues,0) AS unowned_issues, coalesce(i.severe_issues,0) AS severe_issues,
       coalesce(l.late_phases,0) AS late_phases, coalesce(l.late_tasks,0) AS late_tasks,
       CASE WHEN b.planned_end IS NOT NULL AND b.current_end > b.planned_end THEN b.current_end - b.planned_end ELSE 0 END AS slip_days,
       array_remove(ARRAY[
         CASE WHEN lower(b.status) = 'delayed' THEN 'Status is Delayed' END,
         CASE WHEN coalesce(l.late_phases,0) > 0 THEN l.late_phases || ' phase(s) past end date' END,
         CASE WHEN coalesce(l.late_tasks,0) > 0 THEN l.late_tasks || ' task(s) past end date' END,
         CASE WHEN b.go_live < current_date THEN 'Go-live date passed' END,
         CASE WHEN b.end_date < current_date THEN 'End date passed' END,
         CASE WHEN b.planned_end IS NOT NULL AND b.current_end > b.planned_end THEN 'End moved ' || (b.current_end - b.planned_end) || 'd past baseline' END], NULL) AS breach_reasons
FROM base b
LEFT JOIN alloc_sum a ON a.pipeline_id = b.pipeline_id
LEFT JOIN team tm ON tm.pipeline_id = b.pipeline_id
LEFT JOIN rd r ON r.pipeline_id = b.pipeline_id
LEFT JOIN docs dc ON dc.pipeline_id = b.pipeline_id
LEFT JOIN cal c ON c.pipeline_id = b.pipeline_id
LEFT JOIN iss i ON i.pipeline_id = b.pipeline_id
LEFT JOIN late l ON l.pipeline_id = b.pipeline_id
WHERE has_tab('project-plans','view');

-- ── Delivery Home: pod booking over the next 60 days ────────────────────
-- Same rule as Team → Pod Utilization: hours booked ÷ (roster × 160) per month.

CREATE OR REPLACE VIEW v_delivery_pod_util WITH (security_invoker = false) AS
WITH months AS (
  SELECT DISTINCT date_trunc('month', d)::date AS mon
  FROM generate_series(current_date, current_date + 60, interval '1 day') d
  WHERE date_trunc('year', d) = date_trunc('year', current_date)          -- no-year month keys; see above
), roster AS (
  SELECT btrim(pod) AS pod, employee_name, lower(btrim(employee_name)) AS k FROM project_team_pods WHERE btrim(coalesce(pod,'')) <> ''
), booked AS (
  SELECT r.pod, m.mon, fa.project, sum((fa.monthly_totals ->> to_char(m.mon,'Mon'))::numeric) AS hours
  FROM roster r CROSS JOIN months m
  JOIN forecast_assignments fa ON lower(btrim(fa.employee_name)) = r.k
  GROUP BY 1,2,3 HAVING sum((fa.monthly_totals ->> to_char(m.mon,'Mon'))::numeric) > 0
)
SELECT r.pod, m.mon, to_char(m.mon,'Mon YYYY') AS month_label,
       count(DISTINCT r.employee_name) AS members,
       count(DISTINCT r.employee_name) * 160 AS capacity,
       coalesce((SELECT sum(hours) FROM booked b WHERE b.pod = r.pod AND b.mon = m.mon), 0) AS hours,
       round(100.0 * coalesce((SELECT sum(hours) FROM booked b WHERE b.pod = r.pod AND b.mon = m.mon), 0) / (count(DISTINCT r.employee_name) * 160), 1) AS pct,
       coalesce((SELECT jsonb_agg(jsonb_build_object('project', b.project, 'hours', b.hours) ORDER BY b.hours DESC)
                 FROM booked b WHERE b.pod = r.pod AND b.mon = m.mon), '[]') AS projects
FROM roster r CROSS JOIN months m
WHERE has_tab('project-plans','view')
GROUP BY r.pod, m.mon;

REVOKE ALL ON v_delivery_home_projects, v_delivery_pod_util FROM anon;
GRANT SELECT ON v_delivery_home_projects, v_delivery_pod_util TO authenticated, service_role;

-- ── Nightly + hourly calendar sync ──────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('delivery-calendar-sync') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'delivery-calendar-sync');
  PERFORM cron.schedule('delivery-calendar-sync', '15 * * * *', $cron$
    SELECT net.http_post(
      url := 'https://mhmxlubithnidopmkwgt.supabase.co/functions/v1/delivery-calendar',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_KEY'),
        'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'DELIVERY_CRON_SECRET')),
      body := '{"action":"cron"}'::jsonb,
      timeout_milliseconds := 150000);
  $cron$);
END $$;
