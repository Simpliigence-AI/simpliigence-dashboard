-- 043 — time_entries_project_guard: stop rejecting upserts of existing rows
--
-- Migration 034 added a BEFORE INSERT OR UPDATE trigger that rejects a
-- name-only project (project_id IS NULL) unless the name is a current option
-- in v_time_project_options. Its "unchanged name" escape only checks
-- TG_OP = 'UPDATE'.
--
-- The app writes almost everything with PostgREST upsert
-- (INSERT ... ON CONFLICT (id) DO UPDATE): approve, reject, un-approve,
-- "Submit week", draft -> submitted, and every My Time edit. PostgreSQL fires
-- the BEFORE INSERT trigger for each proposed row FIRST, before it knows there
-- is a conflict, so TG_OP is 'INSERT' even when the row already exists and the
-- project is not being changed. Result since 23 Sep 2026: any existing entry on
-- a retired / legacy name-only project can no longer be approved, rejected,
-- submitted or edited by anyone — the trigger raises
--   Project "..." is not a current project — pick one from the list
-- (approvals in Team Time also failed silently until the client fix that ships
-- with this migration).
--
-- Fix: on INSERT, also let the row through when a row with the same id already
-- exists with the same project_name and project_id (i.e. this is the INSERT
-- half of an upsert that does not change the project). New rows and real
-- project changes are still checked exactly as before.
--
-- Idempotent; safe to re-run. Apply in the SQL editor.

create or replace function public.time_entries_project_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.project_name is not distinct from old.project_name then
    return new;
  end if;
  if new.project_id is not null then
    return new;
  end if;
  -- INSERT half of an upsert on an existing row that keeps its project.
  if tg_op = 'INSERT' and exists (
    select 1 from public.time_entries t
     where t.id = new.id
       and t.project_name is not distinct from new.project_name
       and t.project_id   is not distinct from new.project_id
  ) then
    return new;
  end if;
  if exists (select 1 from public.v_time_project_options o where o.name = new.project_name) then
    return new;
  end if;
  raise exception 'Project "%" is not a current project — pick one from the list', left(new.project_name, 60)
    using errcode = 'check_violation';
end $$;
revoke execute on function public.time_entries_project_guard() from public, anon;

-- Trigger definition unchanged from 034; recreated so this file stands alone.
drop trigger if exists time_entries_project_guard on public.time_entries;
create trigger time_entries_project_guard
  before insert or update of project_name, project_id on public.time_entries
  for each row execute function public.time_entries_project_guard();
