-- A project plan can now create its own Current Projects entry.
--
-- Until now a plan created with "Link to Current Projects" left blank stayed
-- plan-only: nothing in pipeline_projects, so it was missing from
-- /projects, from the Team allocation picker and from the /my-time project
-- list (v_time_project_options reads pipeline_projects). "Simpliigence - Demo
-- Org" (26 Sep 2026) hit exactly this.
--
-- delivery_add_to_current_projects(plan id):
--   * reuses an unlinked pipeline_projects row with the same name if one exists,
--     otherwise creates 'gov-<plan id>' — the same id shape the migrated
--     Governance projects already use;
--   * source 'zoho' because that is what Current Projects, the allocation
--     picker and the time picker all filter on;
--   * links the plan, then pushes phases and dates with the existing
--     delivery_push_to_pipeline().
-- Gated on project-plans edit, same as creating a plan. SECURITY DEFINER
-- because plan editors need not hold the financial 'pipeline' tab.
--
-- Safe to re-run.

CREATE OR REPLACE FUNCTION delivery_add_to_current_projects(p_project_id TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  prj  delivery_projects;
  v_id TEXT;
BEGIN
  IF NOT has_tab('project-plans', 'edit') THEN
    RAISE EXCEPTION 'You need edit access to Project Plans to do this.';
  END IF;

  SELECT * INTO prj FROM delivery_projects WHERE id = p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan % not found.', p_project_id; END IF;
  IF prj.pipeline_project_id IS NOT NULL THEN RETURN prj.pipeline_project_id; END IF;

  SELECT p.id INTO v_id
  FROM pipeline_projects p
  LEFT JOIN delivery_projects d ON d.pipeline_project_id = p.id
  WHERE d.id IS NULL AND lower(trim(p.name)) = lower(trim(prj.name))
  ORDER BY (p.status = 'Archived'), p.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_id IS NULL THEN
    v_id := 'gov-' || prj.id;
    INSERT INTO pipeline_projects (id, name, status, owner, start_date, end_date, source,
                                   governance_project_id, governance_project_name, updated_by)
    VALUES (v_id, prj.name,
            CASE WHEN prj.status = 'completed' THEN 'Completed' ELSE 'In Progress' END,
            COALESCE(NULLIF(trim(prj.pm), ''), NULLIF(trim(prj.delivery_lead), ''), ''),
            prj.start_date::text, COALESCE(prj.current_end, prj.planned_end)::text, 'zoho',
            prj.id, prj.name, auth.email())
    ON CONFLICT (id) DO NOTHING;
  ELSE
    -- An existing row reused: make sure it shows under Current Projects.
    UPDATE pipeline_projects SET source = 'zoho',
      status = CASE WHEN status = 'Archived' THEN 'In Progress' ELSE status END
    WHERE id = v_id;
  END IF;

  UPDATE delivery_projects SET pipeline_project_id = v_id, updated_at = now() WHERE id = prj.id;
  PERFORM delivery_push_to_pipeline(prj.id);
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION delivery_add_to_current_projects(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION delivery_add_to_current_projects(TEXT) TO authenticated;
