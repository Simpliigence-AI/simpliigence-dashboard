-- 048 · Delivery rebuild (21 Nov 2026)
--
--  1. Segments + accounts: every project plan belongs to an account, and every
--     account to one segment — Strategic Accounts, SMB, Strategic Placement.
--  2. Weekly check-in owner per project (Sujatha / Vivek).
--  3. Suggested issues: issues pulled from email, Teams, Slack and status
--     reports land as 'suggested'; the PM accepts or dismisses them.
--  4. Concierge: weekly check-ins and an issue log per account.
--  5. Client portal: per-person logins issued by us, scoped to projects /
--     concierge accounts. Clients never get a Supabase auth session — the
--     portal talks only to the client-portal edge function (service role), so
--     no internal RLS policy can ever apply to them.

-- ── 1. Accounts and segments ────────────────────────────────────────────
create table if not exists public.delivery_accounts (
  id text primary key default gen_random_uuid()::text,
  name text not null unique,
  segment text not null check (segment in ('strategic', 'smb', 'placement')),
  concierge_account_id text references public.concierge_accounts(id) on delete set null,
  sort_order int not null default 100,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.delivery_accounts enable row level security;
drop policy if exists "tab: project-plans" on public.delivery_accounts;
create policy "tab: project-plans" on public.delivery_accounts for all to authenticated
  using (has_tab('project-plans', 'view')) with check (has_tab('project-plans', 'edit'));
grant select, insert, update, delete on public.delivery_accounts to authenticated;

alter table public.delivery_projects
  add column if not exists account_id text references public.delivery_accounts(id) on delete set null,
  add column if not exists checkin_owner text,
  add column if not exists slack_channel_id text,
  add column if not exists portal_settings jsonb not null
    default '{"plan": true, "documents": true, "deliverables": true, "issues": false, "meetings": false}'::jsonb;

alter table public.delivery_documents
  add column if not exists client_visible boolean not null default false,
  add column if not exists client_deliverable boolean not null default false,
  add column if not exists uploaded_by_client text;

-- ── 3. Suggested issues (projects and concierge accounts) ───────────────
create table if not exists public.extracted_issues (
  id text primary key default gen_random_uuid()::text,
  project_id text references public.delivery_projects(id) on delete cascade,
  concierge_account_id text references public.concierge_accounts(id) on delete cascade,
  description text not null,
  criticality text not null default 'medium' check (criticality in ('low', 'medium', 'high', 'critical')),
  owner_hint text,
  due_hint date,
  source text not null check (source in ('email', 'teams', 'slack', 'status_report', 'ticket')),
  source_ref text,
  source_title text,
  source_from text,
  source_url text,
  source_excerpt text,
  source_at timestamptz,
  dedupe_key text not null unique,
  state text not null default 'suggested' check (state in ('suggested', 'accepted', 'dismissed')),
  accepted_issue_id text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((project_id is null) <> (concierge_account_id is null))
);
create index if not exists extracted_issues_project on public.extracted_issues (project_id, state);
create index if not exists extracted_issues_concierge on public.extracted_issues (concierge_account_id, state);
alter table public.extracted_issues enable row level security;
drop policy if exists "read by tab" on public.extracted_issues;
create policy "read by tab" on public.extracted_issues for select to authenticated
  using (case when project_id is not null then has_tab('project-plans', 'view') else is_authorized_user() end);
grant select on public.extracted_issues to authenticated;

-- Sources the extractor has already read (so it never pays to read them twice).
create table if not exists public.extraction_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  sources jsonb,          -- per source: { read, matched, suggested, error }
  error text
);
alter table public.extraction_runs enable row level security;
drop policy if exists "read by tab" on public.extraction_runs;
create policy "read by tab" on public.extraction_runs for select to authenticated using (has_tab('project-plans', 'view'));
grant select on public.extraction_runs to authenticated;

create table if not exists public.extraction_seen (
  source text not null,
  ref text not null,
  seen_at timestamptz not null default now(),
  primary key (source, ref)
);
alter table public.extraction_seen enable row level security;

-- ── 4. Concierge check-ins and issues ───────────────────────────────────
alter table public.concierge_accounts
  add column if not exists checkin_owner text,
  add column if not exists slack_channel_id text,
  add column if not exists portal_settings jsonb not null
    default '{"tickets": true, "documents": true, "deliverables": true}'::jsonb;

alter table public.concierge_account_documents
  add column if not exists client_visible boolean not null default false,
  add column if not exists uploaded_by_client text;

create table if not exists public.concierge_checkins (
  id text primary key default gen_random_uuid()::text,
  account_id text not null references public.concierge_accounts(id) on delete cascade,
  week_ending date not null,
  health text check (health in ('green', 'amber', 'red')),
  summary text,
  risks text,
  next_week text,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_by text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, week_ending)
);
alter table public.concierge_checkins enable row level security;
drop policy if exists "Authorized users only" on public.concierge_checkins;
create policy "Authorized users only" on public.concierge_checkins for all to authenticated
  using (is_authorized_user()) with check (is_authorized_user());
grant select, insert, update, delete on public.concierge_checkins to authenticated;

create table if not exists public.concierge_issues (
  id text primary key default gen_random_uuid()::text,
  account_id text not null references public.concierge_accounts(id) on delete cascade,
  description text not null,
  owner text,
  due_date date,
  criticality text not null default 'medium' check (criticality in ('low', 'medium', 'high', 'critical')),
  state text not null default 'open' check (state in ('open', 'closed')),
  created_by text,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.concierge_issues enable row level security;
drop policy if exists "Authorized users only" on public.concierge_issues;
create policy "Authorized users only" on public.concierge_issues for all to authenticated
  using (is_authorized_user()) with check (is_authorized_user());
grant select, insert, update, delete on public.concierge_issues to authenticated;

-- Accept / dismiss a suggestion. Accepting creates the real issue.
create or replace function public.extracted_issue_decide(p_id text, p_accept boolean, p_criticality text default null, p_owner text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  x extracted_issues;
  who text := coalesce(auth.jwt() ->> 'email', 'unknown');
  new_id text;
begin
  select * into x from extracted_issues where id = p_id for update;
  if not found then raise exception 'Suggestion not found'; end if;
  if x.project_id is not null and not has_tab('project-plans', 'edit') then raise exception 'Project Plans edit access needed'; end if;
  if x.concierge_account_id is not null and not is_authorized_user() then raise exception 'Not authorised'; end if;
  if x.state <> 'suggested' then return x.accepted_issue_id; end if;

  if p_accept then
    new_id := gen_random_uuid()::text;
    if x.project_id is not null then
      insert into delivery_issues (id, project_id, description, owner, due_date, criticality, impact, state, created_by)
      values (new_id, x.project_id, x.description, coalesce(p_owner, x.owner_hint), x.due_hint,
              coalesce(p_criticality, x.criticality),
              'From ' || replace(x.source, '_', ' ') || coalesce(': ' || x.source_title, ''), 'open', who);
    else
      insert into concierge_issues (id, account_id, description, owner, due_date, criticality, created_by)
      values (new_id, x.concierge_account_id, x.description, coalesce(p_owner, x.owner_hint), x.due_hint,
              coalesce(p_criticality, x.criticality), who);
    end if;
  end if;
  update extracted_issues set state = case when p_accept then 'accepted' else 'dismissed' end,
    accepted_issue_id = new_id, decided_by = who, decided_at = now()
  where id = p_id;
  return new_id;
end $$;
revoke all on function public.extracted_issue_decide(text, boolean, text, text) from public, anon;
grant execute on function public.extracted_issue_decide(text, boolean, text, text) to authenticated;

-- ── 5. Client portal ────────────────────────────────────────────────────
create table if not exists public.portal_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  full_name text,
  company text,
  password_hash text,
  active boolean not null default true,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  password_set_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
create table if not exists public.portal_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.portal_users(id) on delete cascade,
  project_id text references public.delivery_projects(id) on delete cascade,
  concierge_account_id text references public.concierge_accounts(id) on delete cascade,
  created_by text,
  created_at timestamptz not null default now(),
  check ((project_id is null) <> (concierge_account_id is null)),
  unique (user_id, project_id),
  unique (user_id, concierge_account_id)
);
create table if not exists public.portal_sessions (
  token_hash text primary key,
  user_id uuid not null references public.portal_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table if not exists public.portal_events (
  id bigserial primary key,
  user_id uuid references public.portal_users(id) on delete set null,
  kind text not null,
  project_id text,
  concierge_account_id text,
  detail jsonb,
  at timestamptz not null default now()
);

alter table public.portal_users enable row level security;
alter table public.portal_grants enable row level security;
alter table public.portal_sessions enable row level security;
alter table public.portal_events enable row level security;

-- Who may manage portal access: anyone who can edit Project Plans or Concierge.
create or replace function public.can_manage_portal() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(has_tab('project-plans', 'edit'), false) or coalesce(has_tab('concierge', 'edit'), false)
$$;
grant execute on function public.can_manage_portal() to authenticated;

drop policy if exists "manage" on public.portal_users;
create policy "manage" on public.portal_users for all to authenticated using (can_manage_portal()) with check (can_manage_portal());
drop policy if exists "manage" on public.portal_grants;
create policy "manage" on public.portal_grants for all to authenticated using (can_manage_portal()) with check (can_manage_portal());
drop policy if exists "read" on public.portal_events;
create policy "read" on public.portal_events for select to authenticated using (can_manage_portal());

-- The password hash is never readable from the app: column-level grants only.
revoke all on public.portal_users from anon, authenticated;
grant select (id, email, full_name, company, active, failed_attempts, locked_until, last_login_at, password_set_at, created_by, created_at)
  on public.portal_users to authenticated;
grant insert (email, full_name, company, active, created_by) on public.portal_users to authenticated;
grant update (full_name, company, active, failed_attempts, locked_until) on public.portal_users to authenticated;
grant delete on public.portal_users to authenticated;
revoke all on public.portal_grants from anon;
grant select, insert, delete on public.portal_grants to authenticated;
revoke all on public.portal_sessions from anon, authenticated;
revoke all on public.portal_events from anon;
grant select on public.portal_events to authenticated;
revoke all on public.extraction_seen from anon, authenticated;

create or replace function public.portal_set_password(p_user uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if not can_manage_portal() then raise exception 'Not allowed to manage portal access'; end if;
  if length(coalesce(p_password, '')) < 10 then raise exception 'Password must be at least 10 characters'; end if;
  update portal_users set password_hash = crypt(p_password, gen_salt('bf', 10)), password_set_at = now(),
    failed_attempts = 0, locked_until = null where id = p_user;
  update portal_sessions set expires_at = now() where user_id = p_user and expires_at > now();   -- a reset signs them out everywhere
end $$;
revoke all on function public.portal_set_password(uuid, text) from public, anon;
grant execute on function public.portal_set_password(uuid, text) to authenticated;

-- Login: service role only (called by the client-portal edge function).
create or replace function public.portal_login(p_email text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  u portal_users;
  tok text;
begin
  select * into u from portal_users where email = lower(trim(p_email));
  if not found or not u.active or u.password_hash is null then
    perform crypt('timing', gen_salt('bf', 10));
    return jsonb_build_object('ok', false, 'error', 'Email or password is incorrect.');
  end if;
  if u.locked_until is not null and u.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'Too many attempts. Try again in 15 minutes.');
  end if;
  if crypt(p_password, u.password_hash) <> u.password_hash then
    update portal_users set failed_attempts = failed_attempts + 1,
      locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end
    where id = u.id;
    insert into portal_events (user_id, kind) values (u.id, 'login_failed');
    return jsonb_build_object('ok', false, 'error', 'Email or password is incorrect.');
  end if;
  tok := encode(gen_random_bytes(32), 'hex');
  insert into portal_sessions (token_hash, user_id, expires_at)
  values (encode(digest(tok, 'sha256'), 'hex'), u.id, now() + interval '12 hours');
  update portal_users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = u.id;
  insert into portal_events (user_id, kind) values (u.id, 'login');
  return jsonb_build_object('ok', true, 'token', tok, 'name', u.full_name, 'email', u.email);
end $$;
revoke all on function public.portal_login(text, text) from public, anon, authenticated;
grant execute on function public.portal_login(text, text) to service_role;

create or replace function public.portal_session_user(p_token text) returns uuid
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select s.user_id from portal_sessions s join portal_users u on u.id = s.user_id
  where s.token_hash = encode(digest(p_token, 'sha256'), 'hex') and s.expires_at > now() and u.active
$$;
revoke all on function public.portal_session_user(text) from public, anon, authenticated;
grant execute on function public.portal_session_user(text) to service_role;

-- Private bucket for client uploads to concierge accounts lives in concierge-docs;
-- project uploads go into delivery-documents under portal/.

-- ── 6. Seed: accounts, segments, names, check-in owners ─────────────────
insert into public.delivery_accounts (name, segment, sort_order) values
  ('LLI', 'strategic', 10),
  ('Copeland', 'strategic', 20),
  ('Orange Capital Partners', 'strategic', 30),
  ('Azenta Life Sciences', 'strategic', 40),
  ('Diesel', 'smb', 10),
  ('Intrigue', 'smb', 20),
  ('Whitmore', 'smb', 30),
  ('Above All', 'smb', 40),
  ('Cedar Springs', 'smb', 50),
  ('Integrity Together', 'smb', 60),
  ('Music Nation', 'smb', 70),
  ('Simpliigence', 'smb', 80),
  ('Ciklum', 'placement', 10),
  ('Paccar', 'placement', 20),
  ('Tango Analytics', 'placement', 30)
on conflict (name) do nothing;

update public.delivery_accounts a set concierge_account_id = c.id
from public.concierge_accounts c
where (a.name = 'Whitmore' and c.name = 'Whitmore') or (a.name = 'Integrity Together' and c.name = 'Integrity Together LLC');

with m(old_name, new_name, account) as (values
  ('Lloyds List Intelligence',            'LLI — Lloyd''s List Intelligence',              'LLI'),
  ('Lloyds List Intelligence - RBAC',     'LLI — RBAC',                                    'LLI'),
  ('Copeland CRMA',                       'Copeland — CRM Analytics',                      'Copeland'),
  ('Copeland Data migration',             'Copeland — Data Migration',                     'Copeland'),
  ('Copeland Support',                    'Copeland — Support',                            'Copeland'),
  ('Copeland AI',                         'Copeland — AI',                                 'Copeland'),
  ('Orange Capital Partners',             'Orange Capital Partners — AI Programme',        'Orange Capital Partners'),
  ('Azenta',                              'Azenta — Salesforce Services',                  'Azenta Life Sciences'),
  ('Diesel - SF Implementation',          'Diesel — Salesforce Implementation',            'Diesel'),
  ('Intrigue - SF Implementation',        'Intrigue — Salesforce Implementation',          'Intrigue'),
  ('Whitmore - SF & Sage 50 integration', 'Whitmore — Salesforce & Sage 50 Integration',   'Whitmore'),
  ('Above All - Phase 2',                 'Above All — Phase 2',                           'Above All'),
  ('Cedar Springs - Phase 2',             'Cedar Springs — Phase 2',                       'Cedar Springs'),
  ('Cedar Springs',                       'Cedar Springs — Phase 1 (retired)',             'Cedar Springs'),
  ('Integrity Together - Org clone',      'Integrity Together — Org Clone',                'Integrity Together'),
  ('Music Nation-Levarus',                'Music Nation — Levarus',                        'Music Nation'),
  ('Simpliigence - Demo Org',             'Simpliigence — Demo Org',                       'Simpliigence'),
  ('Inspira - Ciklum',                    'Inspira — Ciklum Placement',                    'Ciklum'),
  ('Pay.uk',                              'Pay.UK — Ciklum Placement',                     'Ciklum'),
  ('Paccar',                              'Paccar — Placement',                            'Paccar'),
  ('Tango',                               'Tango Analytics — Placement',                   'Tango Analytics')
)
update public.delivery_projects p
set name = m.new_name, client = m.account,
    account_id = (select id from public.delivery_accounts a where a.name = m.account),
    updated_by = 'claude'
from m where p.name = m.old_name;

-- The original Cedar Springs plan is superseded by Phase 2.
update public.delivery_projects set status = 'completed', updated_by = 'claude'
where name = 'Cedar Springs — Phase 1 (retired)';

-- Weekly check-ins: Vivek runs the placements, Sujatha everything else.
update public.delivery_projects p set checkin_owner = case
    when a.segment = 'placement' then 'vivek.royan@simpliigence.com'
    else 'sujatha.neelakannan@simpliigence.com' end
from public.delivery_accounts a where a.id = p.account_id and p.checkin_owner is null;

update public.concierge_accounts set checkin_owner = 'sujatha.neelakannan@simpliigence.com'
where not coalesce(is_dormant, false) and checkin_owner is null;
