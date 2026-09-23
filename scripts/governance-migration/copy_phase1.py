#!/usr/bin/env python3
"""
Copy Delivery Governance data (Render Postgres) into the Dashboard (Supabase).

Phase 1 scope: projects, tasks, baselines, change requests, issues — plus
'project-plans' tab access for everyone who had a Governance login and needs
a per-person grant.

Requires migration 033_delivery_governance_core.sql to be applied first.

Usage
  pip install "psycopg[binary]"
  export GOV_DATABASE_URL='postgresql://...render.com/governance_n9z8'   # Render → gov-postgres → External URL
  export SUPABASE_DB_URL='postgresql://postgres.<ref>:...@...pooler.supabase.com:5432/postgres'
  python3 copy_phase1.py            # dry run: prints what it would do, writes nothing
  python3 copy_phase1.py --apply    # writes, in one transaction

Properties
  * Read-only against Governance. Never writes there.
  * Idempotent: upserts on the Governance ids, so it can be re-run during the
    parallel-run period to pick up edits made in Governance. Re-running
    overwrites Dashboard-side edits to the same rows, so stop re-running once
    the team switches to editing in the Dashboard.
  * All-or-nothing: one transaction; any error rolls the whole copy back.
  * Governance stores dates as strings where '' means "not set"; mapped to NULL.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

# Governance status → Dashboard status. Governance only ever used these two.
PROJECT_STATUS = {"active": "active", "completed": "completed"}


def d(v):
    """'' / None / whitespace → None; 'YYYY-MM-DD' → date."""
    if v is None:
        return None
    if isinstance(v, date):
        return v
    s = str(v).strip()
    if not s:
        return None
    return date.fromisoformat(s[:10])


def s(v):
    """Empty string → None, so the Dashboard shows '—' instead of a blank."""
    if v is None:
        return None
    v = str(v).strip()
    return v or None


def j(v, default):
    if v is None:
        return Jsonb(default)
    if isinstance(v, str):
        v = json.loads(v) if v.strip() else default
    return Jsonb(v)


def fetch(conn, sql):
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql)
        return cur.fetchall()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write to Supabase (default is a dry run)")
    args = ap.parse_args()

    gov_url = os.environ.get("GOV_DATABASE_URL")
    sb_url = os.environ.get("SUPABASE_DB_URL")
    if not gov_url or not sb_url:
        print("Set GOV_DATABASE_URL and SUPABASE_DB_URL.", file=sys.stderr)
        return 2

    with psycopg.connect(gov_url) as gov:
        gov.read_only = True
        projects = fetch(gov, "select * from projects order by created_at, id")
        # No created_at on tasks. Order by dates then name so the plan reads
        # chronologically; sort_order preserves it from here on.
        tasks = fetch(gov, 'select * from tasks order by project_id, start nulls last, "end" nulls last, name, id')
        baselines = fetch(gov, "select * from baselines order by snapshot_at, id")
        crs = fetch(gov, "select * from change_requests order by created_at, id")
        issues = fetch(gov, "select * from issues order by created_at, id")
        users = fetch(gov, "select email, name, role from users")

    with psycopg.connect(sb_url) as sb:
        # Governance id → pipeline_projects.id, from the links the existing
        # "Sync with Delivery Governance" dialog already confirmed by hand.
        links = {
            r["governance_project_id"]: r["id"]
            for r in fetch(sb, "select id, governance_project_id from pipeline_projects where governance_project_id is not null")
        }
        dash_users = {
            r["email"].lower(): r
            for r in fetch(sb, "select email, role, coalesce(active,true) as active from authorized_users")
        }

        unlinked = [p["name"] for p in projects if p["id"] not in links]
        report = {
            "projects": len(projects),
            "linked_to_pipeline": len(projects) - len(unlinked),
            "tasks": len(tasks),
            "baselines": len(baselines),
            "change_requests": len(crs),
            "issues": len(issues),
        }

        with sb.cursor() as cur:
            for p in projects:
                cur.execute(
                    """
                    insert into delivery_projects (
                      id, pipeline_project_id, name, client, sow_id, template, status,
                      start_date, planned_end, current_end, pm, delivery_lead, architect, sponsor,
                      frozen_requirements, frozen_exclusions, sharepoint_site_id, sharepoint_folder,
                      teams_channel_id, zoho_project_id, created_at, updated_by)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,coalesce(%s, now()),'governance-migration')
                    on conflict (id) do update set
                      pipeline_project_id = excluded.pipeline_project_id,
                      name = excluded.name, client = excluded.client, sow_id = excluded.sow_id,
                      template = excluded.template, status = excluded.status,
                      start_date = excluded.start_date, planned_end = excluded.planned_end,
                      current_end = excluded.current_end, pm = excluded.pm,
                      delivery_lead = excluded.delivery_lead, architect = excluded.architect,
                      sponsor = excluded.sponsor, frozen_requirements = excluded.frozen_requirements,
                      frozen_exclusions = excluded.frozen_exclusions,
                      sharepoint_site_id = excluded.sharepoint_site_id,
                      sharepoint_folder = excluded.sharepoint_folder,
                      teams_channel_id = excluded.teams_channel_id,
                      zoho_project_id = excluded.zoho_project_id,
                      updated_by = excluded.updated_by
                    """,
                    (
                        p["id"], links.get(p["id"]), p["name"], s(p.get("client")), s(p.get("sow_id")),
                        s(p.get("template")), PROJECT_STATUS.get((p.get("status") or "").lower(), "active"),
                        d(p.get("start_date")), d(p.get("planned_end")), d(p.get("current_end")),
                        s(p.get("pm")), s(p.get("delivery_lead")), s(p.get("architect")), s(p.get("sponsor")),
                        j(p.get("frozen_requirements"), []), j(p.get("frozen_exclusions"), []),
                        s(p.get("sharepoint_site_id")), s(p.get("sharepoint_folder")),
                        s(p.get("teams_channel_id")), s(p.get("zoho_project_id")), p.get("created_at"),
                    ),
                )

            # Parents before children so the self-FK holds.
            order = {}
            ordered = sorted(tasks, key=lambda t: t.get("parent_id") is not None)
            for t in ordered:
                n = order.get(t["project_id"], 0)
                order[t["project_id"]] = n + 1
                pct = max(0, min(100, int(t.get("percent") or 0)))
                status = "done" if (t.get("status") == "done") else "task"
                cur.execute(
                    """
                    insert into delivery_tasks (
                      id, project_id, parent_id, name, phase, start_date, end_date, percent, status,
                      source, cr_id, depends_on, assignee, sort_order, external_id, updated_by)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'governance-migration')
                    on conflict (id) do update set
                      project_id = excluded.project_id, parent_id = excluded.parent_id,
                      name = excluded.name, phase = excluded.phase, start_date = excluded.start_date,
                      end_date = excluded.end_date, percent = excluded.percent, status = excluded.status,
                      source = excluded.source, cr_id = excluded.cr_id, depends_on = excluded.depends_on,
                      assignee = excluded.assignee, sort_order = excluded.sort_order,
                      external_id = excluded.external_id, updated_by = excluded.updated_by
                    """,
                    (
                        t["id"], t["project_id"], s(t.get("parent_id")), t["name"], s(t.get("phase")),
                        d(t.get("start")), d(t.get("end")), pct, status, s(t.get("source")) or "manual",
                        s(t.get("cr_id")), j(t.get("depends_on"), []), s(t.get("assignee")),
                        n * 10, s(t.get("external_id")),
                    ),
                )

            for b in baselines:
                cur.execute(
                    """
                    insert into delivery_baselines (id, project_id, snapshot_at, source, cr_id, label,
                      tasks_snapshot, task_count, planned_end)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    on conflict (id) do nothing
                    """,
                    (
                        b["id"], b["project_id"], b["snapshot_at"], s(b.get("source")) or "initial",
                        s(b.get("cr_id")), s(b.get("label")), j(b.get("tasks_snapshot"), []),
                        int(b.get("task_count") or 0), d(b.get("planned_end")),
                    ),
                )

            for c in crs:
                cur.execute(
                    """
                    insert into delivery_change_requests (id, project_id, request_id, title, description,
                      impact_days, impact_hours, milestone_shift, approvers, state, created_at)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    on conflict (id) do update set
                      title = excluded.title, description = excluded.description,
                      impact_days = excluded.impact_days, impact_hours = excluded.impact_hours,
                      milestone_shift = excluded.milestone_shift, approvers = excluded.approvers,
                      state = excluded.state
                    """,
                    (
                        c["id"], c["project_id"], s(c.get("request_id")), c["title"], s(c.get("description")),
                        c.get("impact_days"), c.get("impact_hours"), s(c.get("milestone_shift")),
                        j(c.get("approvers"), []), s(c.get("state")) or "pending", c.get("created_at"),
                    ),
                )

            for i in issues:
                cur.execute(
                    """
                    insert into delivery_issues (id, project_id, description, owner, due_date, criticality,
                      impact, state, created_at, closed_at, created_from_checkin_id, created_by)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    on conflict (id) do update set
                      description = excluded.description, owner = excluded.owner,
                      due_date = excluded.due_date, criticality = excluded.criticality,
                      impact = excluded.impact, state = excluded.state, closed_at = excluded.closed_at
                    """,
                    (
                        i["id"], i["project_id"], i["description"], s(i.get("owner")), d(i.get("due_date")),
                        s(i.get("criticality")) or "medium", s(i.get("impact")), s(i.get("state")) or "open",
                        i.get("created_at"), i.get("closed_at"), s(i.get("created_from_checkin_id")),
                        s(i.get("created_by")),
                    ),
                )

            # Access. admin/manager already get it by role (migration 033).
            # Governance users whose Dashboard role is 'employee' need a
            # per-person grant; Governance users with no Dashboard login are
            # reported so someone can add them — nothing is created for them.
            granted, missing = [], []
            for u in users:
                email = (u["email"] or "").lower()
                du = dash_users.get(email)
                if not du or not du["active"]:
                    missing.append(email)
                    continue
                if du["role"] in ("admin", "manager"):
                    continue
                cur.execute(
                    """
                    insert into user_tab_permissions (email, tab_key, can_view, can_edit, can_approve, note, updated_by)
                    values (%s, 'project-plans', true, true, false, 'Had a Delivery Governance login', 'governance-migration')
                    on conflict (email, tab_key) do nothing
                    """,
                    (email,),
                )
                granted.append(email)

            # Verify inside the transaction before committing.
            cur.execute(
                """
                select (select count(*) from delivery_projects where id = any(%s)),
                       (select count(*) from delivery_tasks where id = any(%s)),
                       (select count(*) from delivery_baselines where id = any(%s)),
                       (select count(*) from delivery_change_requests where id = any(%s)),
                       (select count(*) from delivery_issues where id = any(%s))
                """,
                (
                    [p["id"] for p in projects], [t["id"] for t in tasks], [b["id"] for b in baselines],
                    [c["id"] for c in crs], [i["id"] for i in issues],
                ),
            )
            got = cur.fetchone()
            want = (len(projects), len(tasks), len(baselines), len(crs), len(issues))
            if got != want:
                raise RuntimeError(f"row-count check failed: wrote {got}, expected {want}")

        report["access_granted"] = granted
        report["governance_users_without_dashboard_login"] = missing
        report["projects_not_linked_to_pipeline"] = unlinked

        if args.apply:
            sb.commit()
            report["result"] = "APPLIED"
        else:
            sb.rollback()
            report["result"] = "DRY RUN — rolled back, nothing written. Re-run with --apply."

    print(json.dumps(report, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
