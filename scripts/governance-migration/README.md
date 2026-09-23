# Delivery Governance → Dashboard migration

Governance (FastAPI + Postgres on Render) is being folded into the Dashboard.
Documents stay in SharePoint; only links move.

| Phase | Moves | Status |
|---|---|---|
| 1 | Projects, tasks/phases, baselines, change requests, issues | Built |
| 2 | Weekly check-ins (status reports), feature heatmap | Built |
| 3 | Document links (SharePoint), client requests + scope classifier | After |
| 4 | Parallel run with Governance read-only, then shut down Render | Last |

## Phase 1 cut-over

1. **Apply the schema.** Run `supabase/migrations/033_delivery_governance_core.sql`
   in the Supabase SQL editor. Additive only: five new `delivery_*` tables, one
   new tab (`project-plans`) and its admin/manager role grants. Nothing existing
   is altered. Safe to re-run.
2. **Dry-run the copy.**
   ```bash
   pip install "psycopg[binary]"
   export GOV_DATABASE_URL='<Render → gov-postgres → External Database URL>'
   export SUPABASE_DB_URL='<Supabase → Project Settings → Database → connection string>'
   python3 scripts/governance-migration/copy_phase1.py
   ```
   Prints counts and who gets access. Writes nothing.
3. **Copy.** Same command with `--apply`. One transaction, verified row counts,
   idempotent (upserts on the Governance ids). It only reads from Governance.
4. **Deploy the UI** (merge this PR). Project Plans appears in the sidebar for
   admins, managers, and anyone granted the tab.
5. During the parallel run, re-running step 3 refreshes the Dashboard from
   Governance. Stop re-running once the team edits in the Dashboard, or their
   edits get overwritten.

Tested end-to-end against a local Postgres loaded with a full export of the
Governance data: 22 projects (all 22 link to an existing Current Projects row),
159 tasks, 15 issues, 1 change request; re-running `--apply` is a no-op.

## Access after the copy

- admin / manager roles: view + edit (role grant in 033).
- Governance users with role `employee` in the Dashboard (Joseph, Shivam,
  Tushar): per-person grant, added by the copy script.
- Governance users **without a Dashboard login** are listed in the output and
  get nothing — add them in Admin → Users first, then re-run. As of the test
  export that's `vasanth@simpliigence.com` (PM on 7 projects) plus two
  personal-address test accounts.

## Phase 2 cut-over

After phase 1 is applied and copied:

1. Run `supabase/migrations/034_delivery_checkins_heatmap.sql`.
2. `python3 scripts/governance-migration/copy_phase2.py` (dry run), then `--apply`.

Copies all 70 heatmap features and the 7 submitted check-ins. The other 67
check-ins are empty drafts Governance auto-created each week; they're skipped.
Submitted check-ins are locked in the database (034 trigger) — a report is a
record of what was said that week.

New tabs on each project: **Heatmap** (click a chip to cycle Not started →
In progress → Built, and Not demoed ↔ Demoed) and **Check-ins** (this week's
draft, Submit to freeze plan + heatmap + open issues, past reports with
**Copy as text** for email/Teams).

## What happens to the old sync

`governance-sync` and the "Sync with Delivery Governance" button keep working
until phase 4 so nothing breaks mid-way. They're removed when Render is shut down.
