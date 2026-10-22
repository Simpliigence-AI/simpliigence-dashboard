-- 041 — Time & materials projects
--
-- pipeline_projects.is_tm marks a T&M engagement. Delivery Home runs its deviance
-- checks (allocation, requirements / design / user stories, meeting cadence, issues,
-- timeline) only on fixed-price projects; T&M projects are listed, tinted amber, and
-- skipped. Set with delivery_set_project_tm() — pipeline_projects itself is gated on
-- the 'pipeline' tab, which delivery managers don't hold.
-- Applied live 26 Sep 2026 via execute_sql.

ALTER TABLE pipeline_projects ADD COLUMN IF NOT EXISTS is_tm boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN pipeline_projects.is_tm IS 'Time & materials engagement. Delivery Home only checks fixed-price projects for plan / docs / cadence / allocation deviances.';

CREATE OR REPLACE FUNCTION delivery_set_project_tm(p_pipeline_id text, p_is_tm boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (has_tab('project-plans','edit') OR has_tab('pipeline','edit')) THEN
    RAISE EXCEPTION 'You need edit access to Project Plans.' USING errcode = '42501';
  END IF;
  UPDATE pipeline_projects SET is_tm = coalesce(p_is_tm,false), updated_at = now() WHERE id = p_pipeline_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION delivery_set_project_tm(text,boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION delivery_set_project_tm(text,boolean) TO authenticated;

-- Same view as 040 with is_tm appended.
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
         CASE WHEN b.planned_end IS NOT NULL AND b.current_end > b.planned_end THEN 'End moved ' || (b.current_end - b.planned_end) || 'd past baseline' END], NULL) AS breach_reasons,
       coalesce((SELECT p.is_tm FROM pipeline_projects p WHERE p.id = b.pipeline_id), false) AS is_tm
FROM base b
LEFT JOIN alloc_sum a ON a.pipeline_id = b.pipeline_id
LEFT JOIN team tm ON tm.pipeline_id = b.pipeline_id
LEFT JOIN rd r ON r.pipeline_id = b.pipeline_id
LEFT JOIN docs dc ON dc.pipeline_id = b.pipeline_id
LEFT JOIN cal c ON c.pipeline_id = b.pipeline_id
LEFT JOIN iss i ON i.pipeline_id = b.pipeline_id
LEFT JOIN late l ON l.pipeline_id = b.pipeline_id
WHERE has_tab('project-plans','view');
