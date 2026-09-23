-- Applied live 23 Sep 2026 (migration time_entry_project_guard_and_drop_zoho_actuals).
-- 1. Actual Hours reads /my-time only. Zoho history is out.
create or replace view public.unified_actual_hours as
 select te.id,
    coalesce(au.employee_code, te.employee_email) as employee_id,
    coalesce(au.full_name, te.employee_email) as employee_name,
    te.employee_email as email,
    te.project_name as project,
    te.work_date,
    te.hours::numeric as hours,
    case when te.billable then 'Billable'::text else 'Non-Billable'::text end as billing,
    te.notes,
    coalesce(te.approved_at, te.submitted_at, te.created_at) as synced_at,
    'simpliigence'::text as source
   from public.time_entries te
     left join public.authorized_users au on lower(au.email) = lower(te.employee_email)
  where te.status = any (array['approved'::text, 'submitted'::text]);

-- 2. The same option list the /my-time picker shows.
create or replace view public.v_time_project_options as
  select name from public.pipeline_projects
   where source = 'zoho' and coalesce(lower(status), '') <> 'completed'
  union
  select name || ' Concierge' from public.concierge_accounts where not coalesce(is_dormant, false)
  union
  select trim(project) from public.india_roster where coalesce(trim(project), '') <> ''
  union
  select unnest(array['Internal — Admin','Internal — Training','Internal — Bench','Internal — Other','Leave / PTO','Holiday']);
grant select on public.v_time_project_options to authenticated, service_role;

-- 3. Guard: a new or changed project name must be id-linked or a current option.
create or replace function public.time_entries_project_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.project_name is not distinct from old.project_name then
    return new;
  end if;
  if new.project_id is not null then
    return new;
  end if;
  if exists (select 1 from public.v_time_project_options o where o.name = new.project_name) then
    return new;
  end if;
  raise exception 'Project "%" is not a current project — pick one from the list', left(new.project_name, 60)
    using errcode = 'check_violation';
end $$;
revoke execute on function public.time_entries_project_guard() from public, anon;

drop trigger if exists time_entries_project_guard on public.time_entries;
create trigger time_entries_project_guard
  before insert or update of project_name, project_id on public.time_entries
  for each row execute function public.time_entries_project_guard();
