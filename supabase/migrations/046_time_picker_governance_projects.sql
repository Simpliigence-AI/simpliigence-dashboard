-- 046 — Time-entry project list: include live Governance-linked projects
--
-- AppDesk #2525 (27 Oct 2026): people allocated to "Diesel - SF Implementation"
-- could not pick it on My Time. The picker (src/lib/useTimeProjectOptions.ts)
-- and this view only listed pipeline_projects with source = 'zoho'. Projects
-- that were set up by hand in the old Delivery Governance tool and carried
-- over keep another source, so they never showed up, and the
-- time_entries_project_guard trigger (034/043) would reject them anyway.
--
-- Change: also list pipeline_projects rows that are linked to a Governance
-- project (governance_project_id set) and are live, i.e. status not
-- Completed / Archived / Proposed / Trashed (same exclusions Delivery Home
-- uses in 040/041). Unlinked manual rows (sales-pipeline prospects) stay out.
-- The client hook applies the identical rule; keep the two in sync.
--
-- Only widens the list of selectable project NAMES. No data is changed.
-- Not applied automatically: apply in the SQL editor after review. Idempotent.

create or replace view public.v_time_project_options as
  select name from public.pipeline_projects
   where source = 'zoho' and coalesce(lower(status), '') <> 'completed'
  union
  select name from public.pipeline_projects
   where coalesce(source, '') <> 'zoho'
     and governance_project_id is not null
     and lower(btrim(coalesce(status, ''))) not in ('completed', 'archived', 'proposed', 'trashed')
  union
  select name || ' Concierge' from public.concierge_accounts where not coalesce(is_dormant, false)
  union
  select trim(project) from public.india_roster where coalesce(trim(project), '') <> ''
  union
  select unnest(array['Internal — Admin','Internal — Training','Internal — Bench','Internal — Other','Leave / PTO','Holiday']);
grant select on public.v_time_project_options to authenticated, service_role;
