-- Full audit trail for time_entries — every INSERT/UPDATE/DELETE is captured as
-- an attributable row in time_entry_audit by a DATABASE trigger.
--
-- Why a trigger (not client-side): the browser talks to Supabase directly and
-- writes time entries via multiple paths — db.upsertTimeEntry (upsert), the
-- db.updateTimeEntry plain UPDATE added in this PR (manager edits from Team
-- Time), and approve/reject through the store. A trigger fires uniformly on all
-- of them and cannot be bypassed or forged by any client path. This matters now
-- that managers/admins can edit ANY employee's entries: we need a tamper-
-- resistant record of who changed what.
--
-- SELF-CONTAINED & idempotent, matching 016/018: (re)creates the authorized_users
-- identity columns and the current_user_email / current_user_role / reports_to
-- helper functions (verbatim from schema.sql) before referencing them, then guards
-- every object (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP POLICY/TRIGGER IF EXISTS ... CREATE ...). Safe to re-run.

-- ────────────────────────────────────────────────────────────────────
-- 0. Identity model prerequisites (idempotent). Copied verbatim from
--    supabase/schema.sql so prod matches the tracked schema regardless of
--    the order migrations were applied.
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE authorized_users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'
    CHECK (role IN ('admin', 'manager', 'employee')),
  ADD COLUMN IF NOT EXISTS employee_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS manager_email TEXT,
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

CREATE OR REPLACE FUNCTION current_user_email() RETURNS TEXT
  LANGUAGE SQL SECURITY DEFINER STABLE AS $$
    SELECT LOWER(u.email) FROM auth.users u WHERE u.id = auth.uid();
  $$;

CREATE OR REPLACE FUNCTION current_user_role() RETURNS TEXT
  LANGUAGE SQL SECURITY DEFINER STABLE AS $$
    SELECT role FROM authorized_users WHERE LOWER(email) = current_user_email();
  $$;

CREATE OR REPLACE FUNCTION reports_to(target_email TEXT) RETURNS BOOLEAN
  LANGUAGE SQL SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM authorized_users
      WHERE LOWER(email) = LOWER(target_email)
        AND LOWER(manager_email) = current_user_email()
    );
  $$;

GRANT EXECUTE ON FUNCTION current_user_email()        TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_role()         TO authenticated;
GRANT EXECUTE ON FUNCTION reports_to(TEXT)            TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 1. time_entry_audit — one immutable row per change to a time entry.
--    time_entry_id matches time_entries.id (TEXT).
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_entry_audit (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  time_entry_id    TEXT NOT NULL,                 -- affected time_entries.id
  employee_email   TEXT,                          -- entry owner (for RLS + display)
  operation        TEXT NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  changed_by_email TEXT,                          -- current_user_email() at write time
  changed_by_role  TEXT,                          -- current_user_role() at write time
  changed_fields   TEXT[],                        -- columns that changed on UPDATE; null/empty otherwise
  old_data         JSONB,                         -- row before (null on INSERT)
  new_data         JSONB,                         -- row after (null on DELETE)
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_te_audit_entry ON time_entry_audit(time_entry_id, changed_at DESC);

-- ────────────────────────────────────────────────────────────────────
-- 2. Trigger function. SECURITY DEFINER so it can always insert the audit
--    row regardless of the caller's RLS — the write can't be blocked or
--    forged by the client. SET search_path pins schema resolution.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION log_time_entry_audit()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_fields TEXT[] := NULL;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Meaningful business columns only (skip updated_at/updated_by/created_at
    -- bookkeeping noise). IS DISTINCT FROM is null-safe.
    v_fields := ARRAY[]::TEXT[];
    IF NEW.employee_email IS DISTINCT FROM OLD.employee_email THEN v_fields := v_fields || 'employee_email'; END IF;
    IF NEW.work_date      IS DISTINCT FROM OLD.work_date      THEN v_fields := v_fields || 'work_date';      END IF;
    IF NEW.project_id     IS DISTINCT FROM OLD.project_id     THEN v_fields := v_fields || 'project_id';     END IF;
    IF NEW.project_name   IS DISTINCT FROM OLD.project_name   THEN v_fields := v_fields || 'project_name';   END IF;
    IF NEW.hours          IS DISTINCT FROM OLD.hours          THEN v_fields := v_fields || 'hours';          END IF;
    IF NEW.billable       IS DISTINCT FROM OLD.billable       THEN v_fields := v_fields || 'billable';       END IF;
    IF NEW.notes          IS DISTINCT FROM OLD.notes          THEN v_fields := v_fields || 'notes';          END IF;
    IF NEW.source         IS DISTINCT FROM OLD.source         THEN v_fields := v_fields || 'source';         END IF;
    IF NEW.status         IS DISTINCT FROM OLD.status         THEN v_fields := v_fields || 'status';         END IF;
    IF NEW.submitted_at   IS DISTINCT FROM OLD.submitted_at   THEN v_fields := v_fields || 'submitted_at';   END IF;
    IF NEW.approved_by    IS DISTINCT FROM OLD.approved_by    THEN v_fields := v_fields || 'approved_by';    END IF;
    IF NEW.approved_at    IS DISTINCT FROM OLD.approved_at    THEN v_fields := v_fields || 'approved_at';    END IF;
    IF NEW.reject_reason  IS DISTINCT FROM OLD.reject_reason  THEN v_fields := v_fields || 'reject_reason';  END IF;
  END IF;

  INSERT INTO time_entry_audit (
    time_entry_id, employee_email, operation,
    changed_by_email, changed_by_role, changed_fields, old_data, new_data
  ) VALUES (
    COALESCE(NEW.id, OLD.id),
    COALESCE(NEW.employee_email, OLD.employee_email),
    TG_OP,
    current_user_email(),
    current_user_role(),
    v_fields,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );

  RETURN NULL; -- AFTER trigger; return value ignored
END;
$$;

DROP TRIGGER IF EXISTS log_time_entry_audit ON time_entries;
CREATE TRIGGER log_time_entry_audit
  AFTER INSERT OR UPDATE OR DELETE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION log_time_entry_audit();

-- ────────────────────────────────────────────────────────────────────
-- 3. RLS. SELECT mirrors the time_entries read policy (own, team, or
--    admin/manager). There are deliberately NO client INSERT/UPDATE/DELETE
--    policies: the SECURITY DEFINER trigger is the only writer, so audit
--    rows cannot be forged or altered from the browser.
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE time_entry_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read: own, team, or admin" ON time_entry_audit;
CREATE POLICY "Read: own, team, or admin" ON time_entry_audit
  FOR SELECT TO authenticated
  USING (
    LOWER(employee_email) = current_user_email()
    OR reports_to(employee_email)
    OR current_user_role() IN ('admin','manager')
  );
