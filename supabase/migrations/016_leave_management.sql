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

-- Realtime + RLS + policies + seed types (see live-applied migration; kept
-- verbatim on disk so a `supabase db reset` reproduces the same state).
