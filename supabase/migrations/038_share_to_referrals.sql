-- 038: "Share to referrals" on requisitions + a referral-safe feed for the Hub.
-- Applied to prod (mhmxlubithnidopmkwgt) on 2026-09-25.
alter table public.india_staffing_requisitions add column if not exists share_to_referrals boolean not null default false;
alter table public.us_staffing_requisitions add column if not exists share_to_referrals boolean not null default false;

-- Open requisitions on an internal account (India "Internal", US "Simpliigence")
-- or explicitly ticked "Share to referrals". Referral-safe fields only:
-- no client/account name, SPOC, probability or notes.
create or replace function public.referral_jobs()
returns table (
  id text, source text, title text, department text, location text,
  positions int, posted text, job_description text, is_internal boolean
)
language sql stable security definer set search_path = public as $$
  select r.id, 'india'::text, r.title, nullif(r.department,''),
         coalesce(nullif(r.location,''),'Bangalore, India'),
         greatest(coalesce(r.new_positions,1),1)::int,
         coalesce(nullif(r.start_date,''), left(r.created_at,10)),
         r.job_description,
         (a.name ilike 'internal%' or a.name ilike 'simpliigence%')
  from india_staffing_requisitions r
  join india_staffing_accounts a on a.id = r.account_id
  where r.status_field in ('Open','In Progress')
    and (r.share_to_referrals or a.name ilike 'internal%' or a.name ilike 'simpliigence%')
  union all
  select r.id, 'us'::text, r.role, null, 'United States', 1,
         coalesce(nullif(r.initiation_date,''), left(r.created_at,10)),
         r.job_description,
         (a.name ilike 'internal%' or a.name ilike 'simpliigence%')
  from us_staffing_requisitions r
  join us_staffing_accounts a on a.id = r.account_id
  where r.stage in ('New','Sourcing','Profiles Shared','Interview','Shortlisted','Client Round')
    and (r.share_to_referrals or a.name ilike 'internal%' or a.name ilike 'simpliigence%')
$$;
revoke all on function public.referral_jobs() from public;
grant execute on function public.referral_jobs() to anon, authenticated;
