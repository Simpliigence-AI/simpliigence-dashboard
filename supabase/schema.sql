-- Simpliigence Dashboard — Supabase Schema
-- Run this in the Supabase SQL Editor (supabase.com → your project → SQL Editor)

-- ============================================================
-- 1. forecast_assignments — one row per employee × project
-- ============================================================
CREATE TABLE forecast_assignments (
  id TEXT PRIMARY KEY,
  employee_name TEXT NOT NULL,
  notes TEXT DEFAULT '',
  role TEXT NOT NULL,
  rate_card NUMERIC,
  is_si BOOLEAN DEFAULT false,
  is_contractor BOOLEAN DEFAULT false,
  project TEXT NOT NULL,
  weekly_hours JSONB DEFAULT '{}',
  monthly_totals JSONB DEFAULT '{}',
  manually_edited BOOLEAN DEFAULT false,
  manually_added BOOLEAN DEFAULT false,
  original_key TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_fa_employee ON forecast_assignments(employee_name);
CREATE INDEX idx_fa_project ON forecast_assignments(project);

-- ============================================================
-- 2. forecast_meta — singleton for week column dates
-- ============================================================
CREATE TABLE forecast_meta (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  week_dates JSONB DEFAULT '[]',
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO forecast_meta (id) VALUES ('singleton');

-- ============================================================
-- 3. financial_settings — singleton
-- ============================================================
CREATE TABLE financial_settings (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  exchange_rate NUMERIC DEFAULT 83.5,
  cad_to_usd_rate NUMERIC DEFAULT 0.73,
  display_currency TEXT DEFAULT 'inr',
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO financial_settings (id) VALUES ('singleton');

-- ============================================================
-- 4. sync_config — singleton for spreadsheet sync settings
-- ============================================================
CREATE TABLE sync_config (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  onedrive_url TEXT DEFAULT '',
  sheet_name TEXT DEFAULT 'Forecasting Hrs',
  auto_sync_on_load BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT DEFAULT 'never',
  last_sync_error TEXT,
  last_sync_row_count INTEGER DEFAULT 0,
  last_sync_member_count INTEGER DEFAULT 0,
  last_sync_project_count INTEGER DEFAULT 0,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO sync_config (id) VALUES ('singleton');

-- ============================================================
-- 5. hiring_forecast_config — singleton for scenario settings
-- ============================================================
CREATE TABLE hiring_forecast_config (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  concierge_config JSONB DEFAULT '{}',
  scenario_settings JSONB DEFAULT '{}',
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO hiring_forecast_config (id) VALUES ('singleton');

-- ============================================================
-- 6. staffing_requests — one row per request
-- ============================================================
CREATE TABLE staffing_requests (
  id TEXT PRIMARY KEY,
  role_category TEXT NOT NULL,
  hours_per_month NUMERIC NOT NULL,
  start_month TEXT NOT NULL,
  end_month TEXT NOT NULL,
  client_name TEXT NOT NULL,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 7. pipeline_projects — one row per project
-- ============================================================
CREATE TABLE pipeline_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  owner TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  source TEXT DEFAULT 'manual',
  zoho_id TEXT,
  forecast_name TEXT,
  go_live_date TEXT,
  revenue NUMERIC,
  revenue_currency TEXT DEFAULT 'USD',
  resources JSONB DEFAULT '[]',
  phases JSONB DEFAULT '[]',
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pp_zoho ON pipeline_projects(zoho_id);

-- ============================================================
-- Enable Realtime on all tables
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE forecast_assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE forecast_meta;
ALTER PUBLICATION supabase_realtime ADD TABLE financial_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE sync_config;
ALTER PUBLICATION supabase_realtime ADD TABLE hiring_forecast_config;
ALTER PUBLICATION supabase_realtime ADD TABLE staffing_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_projects;

-- ============================================================
-- Row Level Security — open for all (internal team dashboard)
-- ============================================================
ALTER TABLE forecast_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON forecast_assignments FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE forecast_meta ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON forecast_meta FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE financial_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON financial_settings FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE sync_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON sync_config FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE hiring_forecast_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON hiring_forecast_config FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE staffing_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON staffing_requests FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE pipeline_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON pipeline_projects FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 8. staffing_accounts — India Staffing client accounts
-- ============================================================
CREATE TABLE staffing_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sa_name ON staffing_accounts(name);

-- ============================================================
-- 9. staffing_requisitions — open positions per account
-- ============================================================
CREATE TABLE staffing_requisitions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES staffing_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  month TEXT NOT NULL,
  new_positions INTEGER DEFAULT 0,
  backfills INTEGER DEFAULT 0,
  expected_closure TEXT DEFAULT '',
  anticipation TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sr_account ON staffing_requisitions(account_id);
CREATE INDEX idx_sr_month ON staffing_requisitions(month);

-- ============================================================
-- 10. staffing_daily_statuses — rolling daily status updates
-- ============================================================
CREATE TABLE staffing_daily_statuses (
  id TEXT PRIMARY KEY,
  requisition_id TEXT NOT NULL REFERENCES staffing_requisitions(id) ON DELETE CASCADE,
  status_date TEXT NOT NULL,
  status_text TEXT NOT NULL DEFAULT '',
  anticipation TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sds_req ON staffing_daily_statuses(requisition_id);
CREATE INDEX idx_sds_date ON staffing_daily_statuses(status_date);

-- Enable Realtime for India Staffing tables
ALTER PUBLICATION supabase_realtime ADD TABLE staffing_accounts;
ALTER PUBLICATION supabase_realtime ADD TABLE staffing_requisitions;
ALTER PUBLICATION supabase_realtime ADD TABLE staffing_daily_statuses;

-- RLS for India Staffing tables
ALTER TABLE staffing_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON staffing_accounts FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE staffing_requisitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON staffing_requisitions FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE staffing_daily_statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON staffing_daily_statuses FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 11. actual_hours — YTD timesheet records synced from Zoho People
-- ============================================================
CREATE TABLE actual_hours (
  id            TEXT PRIMARY KEY,         -- Zoho recordId
  employee_id   TEXT NOT NULL,            -- Zoho EmployeeID
  employee_name TEXT NOT NULL,
  email         TEXT,
  project       TEXT,                     -- jobName / clientName from Zoho People
  work_date     DATE NOT NULL,
  hours         NUMERIC NOT NULL,
  billing       TEXT,                     -- "Billable" / "Non-Billable" / null
  notes         TEXT,
  synced_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_actual_hours_date ON actual_hours(work_date);
CREATE INDEX idx_actual_hours_emp  ON actual_hours(employee_id);
CREATE INDEX idx_actual_hours_proj ON actual_hours(project);

ALTER PUBLICATION supabase_realtime ADD TABLE actual_hours;

ALTER TABLE actual_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON actual_hours FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 12. team_members — user × team many-to-many (e.g. team='ta')
-- ============================================================
CREATE TABLE team_members (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  team       TEXT NOT NULL,
  added_by   TEXT,
  added_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(email, team)
);
CREATE INDEX idx_team_members_team  ON team_members(team);
CREATE INDEX idx_team_members_email ON team_members(email);

ALTER PUBLICATION supabase_realtime ADD TABLE team_members;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON team_members FOR ALL USING (true) WITH CHECK (true);

-- india_staffing_candidates.owning_ta_email — one TA "owns" the candidate;
-- drives "My Day" auto-population of requisitions on the TA Daily Log page.
ALTER TABLE india_staffing_candidates ADD COLUMN IF NOT EXISTS owning_ta_email TEXT;
CREATE INDEX IF NOT EXISTS idx_isc_owner ON india_staffing_candidates(owning_ta_email);

-- LinkedIn URL + resume attachment + auto-parsed skills/summary
ALTER TABLE india_staffing_candidates
  ADD COLUMN IF NOT EXISTS linkedin_url       TEXT,
  ADD COLUMN IF NOT EXISTS resume_url         TEXT,  -- storage object path within candidate-resumes bucket
  ADD COLUMN IF NOT EXISTS resume_filename    TEXT,
  ADD COLUMN IF NOT EXISTS resume_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS skills             TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS profile_summary    TEXT,
  ADD COLUMN IF NOT EXISTS parsed_at          TIMESTAMPTZ;

-- Storage bucket 'candidate-resumes' is created via migration (not declarable here in plain DDL).
-- Resumes are parsed by the parse-resume edge function (Claude multimodal) and the
-- skills + profile_summary columns are populated automatically.

-- ============================================================
-- 13. ta_daily_log — one row per (TA × day × requisition)
-- ============================================================
CREATE TABLE ta_daily_log (
  id                      TEXT PRIMARY KEY,
  ta_email                TEXT NOT NULL,
  log_date                DATE NOT NULL,
  requisition_id          TEXT NOT NULL REFERENCES india_staffing_requisitions(id) ON DELETE CASCADE,
  sourced_outreach        INTEGER DEFAULT 0,
  screens_completed       INTEGER DEFAULT 0,
  submissions_interviews  INTEGER DEFAULT 0,
  notes                   TEXT DEFAULT '',
  daily_status_id         TEXT REFERENCES india_staffing_statuses(id) ON DELETE SET NULL,
  updated_by              TEXT,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  UNIQUE(ta_email, log_date, requisition_id)
);
CREATE INDEX idx_tdl_ta_date  ON ta_daily_log(ta_email, log_date DESC);
CREATE INDEX idx_tdl_req_date ON ta_daily_log(requisition_id, log_date DESC);
CREATE INDEX idx_tdl_date     ON ta_daily_log(log_date DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE ta_daily_log;
ALTER TABLE ta_daily_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON ta_daily_log FOR ALL USING (true) WITH CHECK (true);

-- Audit triggers — record_audit() defined in admin section migration
CREATE TRIGGER audit_team_members
  AFTER INSERT OR UPDATE OR DELETE ON team_members
  FOR EACH ROW EXECUTE FUNCTION record_audit();

CREATE TRIGGER audit_ta_daily_log
  AFTER INSERT OR UPDATE OR DELETE ON ta_daily_log
  FOR EACH ROW EXECUTE FUNCTION record_audit();
