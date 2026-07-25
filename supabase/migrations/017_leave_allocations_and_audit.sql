-- Per-employee leave allocations + trigger-driven audit trail.
-- See the applied migration in live SQL — this file is kept so a
-- `supabase db reset` reproduces the same state locally.

CREATE TABLE IF NOT EXISTS leave_allocations (
  id TEXT PRIMARY KEY,
  employee_email TEXT NOT NULL,
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  year INT NOT NULL,
  quota NUMERIC NOT NULL DEFAULT 0,
  carried_forward NUMERIC NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('zoho_import','admin','rollover','csv_import')),
  notes TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_email, leave_type_id, year)
);

CREATE INDEX IF NOT EXISTS idx_leave_allocations_employee ON leave_allocations(employee_email);
CREATE INDEX IF NOT EXISTS idx_leave_allocations_year     ON leave_allocations(year);

CREATE TABLE IF NOT EXISTS leave_audit (
  id BIGSERIAL PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_email TEXT,
  before_data JSONB,
  after_data JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leave_audit_entity     ON leave_audit(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_leave_audit_actor      ON leave_audit(actor_email);
CREATE INDEX IF NOT EXISTS idx_leave_audit_changed_at ON leave_audit(changed_at DESC);

-- RLS + trigger function + triggers — see live migration for full policy
-- and function bodies. Everything is idempotent so a re-apply is safe.
