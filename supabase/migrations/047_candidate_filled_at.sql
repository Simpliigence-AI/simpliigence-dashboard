-- 047 — Date a position was closed: india_staffing_candidates.filled_at.
-- Applied live on 13 Nov 2026 via execute_sql; this file records it. Safe to re-run.
--
-- The India Demand scorecard counts a position as closed when a candidate reaches
-- Offer Accepted or Joined. Candidate stage changes are not audited, so there was no
-- reliable date for that. The trigger stamps it the first time a filled stage is
-- reached, keeps it through Offer Accepted -> Joined, and clears it if the stage moves
-- back. The client never sends filled_at.

alter table public.india_staffing_candidates add column if not exists filled_at timestamptz;

create or replace function public.stamp_candidate_filled_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.stage in ('Offer Accepted', 'Joined') then
    if tg_op = 'UPDATE' and old.stage in ('Offer Accepted', 'Joined') then
      new.filled_at := coalesce(old.filled_at, new.filled_at, now());
    else
      new.filled_at := coalesce(new.filled_at, now());
    end if;
  else
    new.filled_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_candidate_filled_at on public.india_staffing_candidates;
create trigger trg_stamp_candidate_filled_at before insert or update on public.india_staffing_candidates
  for each row execute function public.stamp_candidate_filled_at();

-- One-time backfill (13 Nov 2026) used the best available date: the row's updated_at,
-- capped at the day the role was marked Closed Won where that came first.
update public.india_staffing_candidates c
   set filled_at = least(
         c.updated_at::timestamptz,
         coalesce((select min(h.changed_at)::timestamptz from public.india_staffing_history h
                    where h.requisition_id = c.requisition_id and h.field = 'status_field' and h.new_value = 'Closed Won'
                      and exists (select 1 from public.india_staffing_requisitions r where r.id = c.requisition_id and r.status_field = 'Closed Won')),
                  c.updated_at::timestamptz))
 where c.stage in ('Offer Accepted', 'Joined') and c.filled_at is null;
