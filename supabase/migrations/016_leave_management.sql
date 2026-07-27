-- Leave management: types + requests. Balances are computed on the fly from
-- leave_types.annual_quota minus the sum of approved-request days in the
-- current calendar year. Manager routing keys off authorized_users.manager_email.

CREATE TABLE IF NOT EXISTS leave_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  annual_quota NUMERIC NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#64748b',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  employee_email TEXT NOT NULL,
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days NUMERIC NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  manager_email TEXT,
  decided_at TIMESTAMPTZ,
  decided_by TEXT,
  decision_comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_email);
CREATE INDEX IF NOT EXISTS idx_leave_requests_manager  ON leave_requests(manager_email);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status   ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates    ON leave_requests(start_date, end_date);

-- Realtime + RLS + policies — see live-applied migration; kept verbatim on
-- disk so a `supabase db reset` reproduces the same state.

-- Default leave-type catalog, mirroring Zoho's THREE leave types (Casual and
-- Sick are a SINGLE combined type in Zoho, not two). NOTE: codes AL/CL are a
-- BEST-GUESS default — the exact Zoho export codes are still being confirmed;
-- COF is confirmed. Treat this as a starting catalog that admins can rename or
-- re-code from the Leave Types admin tab; do NOT rely on these ids/codes when
-- reconciling the live database. Idempotent: ON CONFLICT (code) DO NOTHING so a
-- re-apply / db reset won't duplicate rows or clobber admin edits.
--
-- Note: editing this already-applied migration only affects fresh environments
-- (`supabase db reset`). To fix the live DB, apply migration 018.
INSERT INTO leave_types (id, name, code, annual_quota, color, active, sort_order) VALUES
  ('annual',   'Annual Leave/Privilege', 'AL',  0, '#2563eb', TRUE, 10),
  ('casual',   'Casual/Sick Leave',      'CL',  0, '#16a34a', TRUE, 20),
  ('comp_off', 'Compensatory Off',       'COF', 0, '#7c3aed', TRUE, 30)
ON CONFLICT (code) DO NOTHING;

-- Pseudo / non-leave placeholder types must never surface as balance cards on
-- the Leave page (which renders one card per *active* type). Idempotent.
UPDATE leave_types SET active = FALSE WHERE upper(code) IN ('ABSENT', 'ABS', 'LOP');
