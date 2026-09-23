#!/usr/bin/env python3
"""
Copy Delivery Governance weekly check-ins and feature heatmap into the
Dashboard. Requires migration 034 and a completed phase-1 copy (the rows
reference delivery_projects).

Usage: same environment variables as copy_phase1.py.
  python3 copy_phase2.py            # dry run
  python3 copy_phase2.py --apply

What it copies
  * Heatmap features: all, upserted on the Governance id.
  * Check-ins: submitted ones, plus any draft with something typed in it.
    Empty auto-created drafts are skipped and counted — they hold nothing.
  * Submitted check-ins are history: inserted once, never overwritten
    (the 034 lock trigger would refuse the update anyway).
  * Where Governance has several drafts for the same project and week, only
    the newest is kept (034 allows one draft per project-week).
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from copy_phase1 import d, s, j, fetch  # same cleaning rules as phase 1

TEXT_FIELDS = ("activities_build", "activities_testing", "activities_demos", "activities_pm", "upcoming_focus")
COMPLETION = {"not_started", "partial", "complete"}
DEMO = {"not_demoed", "demoed"}


def has_content(c) -> bool:
    if any((c.get(f) or "").strip() for f in TEXT_FIELDS):
        return True
    for f in ("plan_snapshot", "heatmap_snapshot", "parking_lot_snapshot"):
        v = c.get(f)
        if isinstance(v, str):
            v = json.loads(v or "[]")
        if v:
            return True
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    gov_url, sb_url = os.environ.get("GOV_DATABASE_URL"), os.environ.get("SUPABASE_DB_URL")
    if not gov_url or not sb_url:
        print("Set GOV_DATABASE_URL and SUPABASE_DB_URL.", file=sys.stderr)
        return 2

    with psycopg.connect(gov_url) as gov:
        gov.read_only = True
        checkins = fetch(gov, "select * from weekly_checkins order by created_at, id")
        features = fetch(gov, "select * from heatmap_features order by project_id, order_index, created_at, id")

    keep, skipped_empty = [], 0
    newest_draft: dict[tuple[str, str], dict] = {}
    for c in checkins:
        if c["status"] == "submitted":
            keep.append(c)
        elif not has_content(c):
            skipped_empty += 1
        else:
            key = (c["project_id"], str(c["week_ending"]))
            prev = newest_draft.get(key)
            if not prev or c["created_at"] > prev["created_at"]:
                newest_draft[key] = c
    dup_drafts = sum(1 for c in checkins if c["status"] != "submitted" and has_content(c)) - len(newest_draft)
    keep.extend(newest_draft.values())

    with psycopg.connect(sb_url) as sb:
        known = {r["id"] for r in fetch(sb, "select id from delivery_projects")}
        orphans = sorted({x["project_id"] for x in keep + features if x["project_id"] not in known})
        if orphans:
            print(f"Run copy_phase1.py --apply first; unknown projects: {orphans}", file=sys.stderr)
            return 3

        with sb.cursor() as cur:
            for f in features:
                comp = f.get("completion_state") if f.get("completion_state") in COMPLETION else "not_started"
                demo = f.get("demo_state") if f.get("demo_state") in DEMO else "not_demoed"
                cur.execute(
                    """
                    insert into delivery_features (id, project_id, name, description, completion_state,
                      demo_state, order_index, notes, created_at)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,coalesce(%s, now()))
                    on conflict (id) do update set
                      name = excluded.name, description = excluded.description,
                      completion_state = excluded.completion_state, demo_state = excluded.demo_state,
                      order_index = excluded.order_index, notes = excluded.notes
                    """,
                    (f["id"], f["project_id"], f["name"], s(f.get("description")), comp, demo,
                     int(f.get("order_index") or 0), s(f.get("notes")), f.get("created_at")),
                )

            for c in keep:
                submitted = c["status"] == "submitted"
                cur.execute(
                    """
                    insert into delivery_checkins (id, project_id, week_ending, status, activities_build,
                      activities_testing, activities_demos, activities_pm, upcoming_focus, plan_snapshot,
                      heatmap_snapshot, parking_lot_snapshot, submitted_at, submitted_by, created_at)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,coalesce(%s, now()))
                    on conflict (id) do nothing
                    """,
                    (
                        c["id"], c["project_id"], d(c["week_ending"]), "submitted" if submitted else "draft",
                        *(s(c.get(f)) for f in TEXT_FIELDS),
                        j(c.get("plan_snapshot"), []), j(c.get("heatmap_snapshot"), []),
                        j(c.get("parking_lot_snapshot"), []),
                        # submitted rows must carry a timestamp (034 check); fall back to created_at.
                        (c.get("submitted_at") or c.get("created_at")) if submitted else None,
                        s(c.get("submitted_by")), c.get("created_at"),
                    ),
                )

            cur.execute(
                "select (select count(*) from delivery_features where id = any(%s)),"
                "       (select count(*) from delivery_checkins where id = any(%s))",
                ([f["id"] for f in features], [c["id"] for c in keep]),
            )
            got, want = cur.fetchone(), (len(features), len(keep))
            if got != want:
                raise RuntimeError(f"row-count check failed: {got} != {want}")

        report = {
            "features": len(features),
            "checkins_copied": len(keep),
            "checkins_submitted": sum(1 for c in keep if c["status"] == "submitted"),
            "empty_drafts_skipped": skipped_empty,
            "duplicate_drafts_collapsed": dup_drafts,
        }
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
