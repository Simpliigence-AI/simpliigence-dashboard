-- 046 — Job ID on India requisitions, and job-ID routing for the resume email intake.
-- Applied live on 13 Nov 2026 via execute_sql; this file records it. Safe to re-run.
--
-- Every India requisition gets a short, human-readable job ID (REQ-1001, REQ-1002, ...).
-- TAs and vendors quote it in an email subject; the resume-intake edge function then
-- files the attached resumes against that requisition instead of the unassigned pool.
-- The database owns the ID: the client never sends job_code.

alter table public.india_staffing_requisitions add column if not exists job_code text;
create sequence if not exists public.india_req_job_code_seq start 1001;

-- Backfill existing requisitions in creation order.
with ordered as (
  select id, row_number() over (order by created_at nulls last, id) as rn
  from public.india_staffing_requisitions where job_code is null
), base as (
  select coalesce(max(substring(job_code from 'REQ-(\d+)')::int), 1000) as n
  from public.india_staffing_requisitions
)
update public.india_staffing_requisitions r
   set job_code = 'REQ-' || (base.n + o.rn)
  from ordered o, base where o.id = r.id;

select setval('public.india_req_job_code_seq',
  greatest(1000, (select coalesce(max(substring(job_code from 'REQ-(\d+)')::int), 1000) from public.india_staffing_requisitions)), true);

create unique index if not exists india_staffing_requisitions_job_code_key
  on public.india_staffing_requisitions (job_code);

create or replace function public.assign_india_req_job_code() returns trigger
language plpgsql set search_path = public as $$
begin
  -- The client saves with upsert, and BEFORE INSERT fires even when the row already
  -- exists. Reuse the existing code in that case so the sequence only moves for a
  -- genuinely new requisition.
  if new.job_code is null then
    select job_code into new.job_code from public.india_staffing_requisitions where id = new.id;
    if new.job_code is null then
      new.job_code := 'REQ-' || nextval('public.india_req_job_code_seq');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_assign_india_req_job_code on public.india_staffing_requisitions;
create trigger trg_assign_india_req_job_code before insert on public.india_staffing_requisitions
  for each row execute function public.assign_india_req_job_code();

-- Resume email intake: record which job ID an email carried and where its resumes went.
-- (The intake tables themselves were created live on 11 Nov 2026; see the project doc
--  resume-email-intake-11nov2026.md. Guarded so this file also runs where they don't exist.)
do $$
begin
  if to_regclass('public.resume_email_intake') is not null then
    alter table public.resume_email_intake
      add column if not exists job_code text,
      add column if not exists requisition_id text;
  end if;
end $$;

-- Who gets emailed when the intake job fails (JSON array of addresses). Seed by hand:
--   insert into public.resume_intake_config(key, value) values ('alert_to', '["someone@simpliigence.com"]');
