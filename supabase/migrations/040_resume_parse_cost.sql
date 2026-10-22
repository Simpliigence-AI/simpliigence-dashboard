-- parse-resume v40: content-hash cache + per-call token/cost log. Applied live 26 Sep 2026.
create table if not exists public.resume_parse_cache (
  sha256 text primary key,
  parsed jsonb not null,
  model text not null,
  source text,
  created_at timestamptz not null default now()
);
create table if not exists public.resume_parse_log (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  candidate_id text,
  sha256 text,
  source text,
  model text,
  cached boolean not null default false,
  escalated boolean not null default false,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  cost_usd numeric(10,6) not null default 0,
  error text
);
create index if not exists resume_parse_log_created_idx on public.resume_parse_log (created_at desc);
alter table public.resume_parse_cache enable row level security;
alter table public.resume_parse_log enable row level security;
create or replace view public.v_resume_parse_cost with (security_invoker = true) as
select date_trunc('month', created_at)::date as month,
       count(distinct candidate_id) filter (where not cached) as parsed_via_claude,
       count(*) filter (where cached) as cache_hits,
       count(*) filter (where escalated and model = 'claude-sonnet-4-5') as sonnet_escalations,
       count(*) filter (where source = 'pdf_document') as scanned_pdf_calls,
       sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
       round(sum(cost_usd), 4) as cost_usd
from public.resume_parse_log group by 1 order by 1 desc;
