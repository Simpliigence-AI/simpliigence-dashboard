-- Duplicate-profile check for resume uploads (26 Sep 2026).
-- Applied live via execute_sql on mhmxlubithnidopmkwgt.
-- Same person = same email, OR same last-10 phone digits, OR same LinkedIn /in/ slug.
-- SECURITY DEFINER so a TA is warned about profiles owned by anyone.
create or replace function public.find_candidate_duplicates(
  p_email text default null, p_phone text default null, p_linkedin text default null, p_exclude_id text default null)
returns table (id text, name text, email text, phone text, owning_ta_email text, stage text,
               requisition_id text, resume_filename text, created_at text, matched_on text)
language sql stable security definer set search_path = public as $$
  with k as (
    select nullif(lower(trim(p_email)),'') e,
           nullif(right(regexp_replace(coalesce(p_phone,''),'\D','','g'),10),'') ph,
           nullif(lower(substring(coalesce(p_linkedin,'') from 'linkedin\.com/in/([^/?#\s]+)')),'') li
  )
  select c.id, c.name, c.email, c.phone, c.owning_ta_email, c.stage, c.requisition_id,
         c.resume_filename, c.created_at,
         concat_ws(', ',
           case when k.e is not null and lower(trim(c.email)) = k.e then 'email' end,
           case when length(k.ph) = 10 and right(regexp_replace(coalesce(c.phone,''),'\D','','g'),10) = k.ph then 'phone' end,
           case when k.li is not null and lower(substring(coalesce(c.linkedin_url,'') from 'linkedin\.com/in/([^/?#\s]+)')) = k.li then 'LinkedIn' end
         ) as matched_on
  from india_staffing_candidates c, k
  where (p_exclude_id is null or c.id <> p_exclude_id)
    and ( (k.e is not null and lower(trim(c.email)) = k.e)
       or (length(k.ph) = 10 and right(regexp_replace(coalesce(c.phone,''),'\D','','g'),10) = k.ph)
       or (k.li is not null and lower(substring(coalesce(c.linkedin_url,'') from 'linkedin\.com/in/([^/?#\s]+)')) = k.li) )
  order by c.created_at
  limit 5;
$$;
revoke execute on function public.find_candidate_duplicates(text,text,text,text) from public, anon;
grant execute on function public.find_candidate_duplicates(text,text,text,text) to authenticated;
