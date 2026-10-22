-- 044 — India T&M requisitions: bill start date, budget/hr (USD), work mode, location
--
-- New requisitions must carry all four (location only when work mode is Hybrid
-- or WFO). Enforced in the UI; columns default so existing rows stay valid.
-- `location` already exists on this table (legacy, kept by 003) — re-used here.
alter table public.india_staffing_requisitions add column if not exists bill_start_date text not null default '';
alter table public.india_staffing_requisitions add column if not exists budget_per_hour_usd numeric(10,2);
alter table public.india_staffing_requisitions add column if not exists work_mode text not null default '';
alter table public.india_staffing_requisitions add column if not exists location text default '';

alter table public.india_staffing_requisitions drop constraint if exists india_req_work_mode_chk;
alter table public.india_staffing_requisitions add constraint india_req_work_mode_chk
  check (work_mode in ('', 'Remote', 'Hybrid', 'WFO'));
