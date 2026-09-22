-- 032_ticket_billing_month_and_fixed_cost.sql
-- Concierge billing: let a ticket be billed in a month other than the one it
-- was created in, and hold a manual per-account monthly fixed cost that is
-- not ticket-dependent.
--
-- Already applied to the live project on 2026-09-22. Every statement is
-- idempotent, so re-running it is a no-op.

-- 1. Billing month override on the ticket. NULL = bill in the created month.
alter table public.tickets add column if not exists billing_month text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tickets'::regclass and conname = 'tickets_billing_month_chk'
  ) then
    alter table public.tickets add constraint tickets_billing_month_chk
      check (billing_month is null or billing_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
  end if;
end $$;

create index if not exists tickets_billing_month_idx on public.tickets (billing_month);

comment on column public.tickets.billing_month is
  'YYYY-MM the ticket is billed in. NULL falls back to the month of created_time. Drives the Concierge Billing tab rollup.';

-- 2. Fixed (non-ticket) monthly cost per account.
--    Keyed by account NAME to match how the Billing tab groups its rows:
--    inbound routing leaves tickets.account_id null whenever it cannot resolve
--    a sender domain, so name is the only key every row reliably has.
create table if not exists public.concierge_fixed_billing (
  id            text primary key,
  account_name  text not null,
  month         text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount        numeric(12,2) not null default 0,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint concierge_fixed_billing_account_month_key unique (account_name, month)
);

create index if not exists concierge_fixed_billing_month_idx
  on public.concierge_fixed_billing (month);

comment on table public.concierge_fixed_billing is
  'Manual fixed monthly charge per account, independent of tickets. Edited inline on Concierge -> Billing.';

alter table public.concierge_fixed_billing enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'concierge_fixed_billing'
      and policyname = 'Authorized users only'
  ) then
    create policy "Authorized users only" on public.concierge_fixed_billing
      for all to authenticated
      using (is_authorized_user())
      with check (is_authorized_user());
  end if;
end $$;
