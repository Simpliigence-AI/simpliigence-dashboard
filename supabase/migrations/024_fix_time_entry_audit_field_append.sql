-- Fix: log_time_entry_audit() broke EVERY UPDATE to time_entries.
--
-- What broke: since 019_time_entry_audit.sql was applied to the live DB
-- (2026-08-05), every UPDATE that changed any tracked column threw
--   22P02 malformed array literal: "hours" — Array value must start with
--   "{" or dimension information
-- and rolled the whole statement back. INSERTs and DELETEs were unaffected
-- (the append block only runs on UPDATE).
--
-- Why: the function appended changed-column names with
--   v_fields := v_fields || 'hours';
-- In Postgres, `text[] || 'literal'` with an UNTYPED string literal resolves
-- to array-concatenation (anycompatiblearray || anycompatiblearray), so the
-- literal 'hours' is cast to text[] and fails at runtime — it is not the
-- intended array-append (anycompatiblearray || anycompatible).
--
-- User-visible impact: edits, approvals and rejections of existing timesheet
-- entries silently failed to save (surfaced by #191/#195).
--
-- The fix: rewrite each append in the unambiguous form
--   v_fields := array_append(v_fields, 'hours');
-- Everything else in the function is unchanged. Idempotent: CREATE OR REPLACE
-- FUNCTION plus a re-assert of the trigger (identical to 019's definition).
-- Safe to re-run.

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
    IF NEW.employee_email IS DISTINCT FROM OLD.employee_email THEN v_fields := array_append(v_fields, 'employee_email'); END IF;
    IF NEW.work_date      IS DISTINCT FROM OLD.work_date      THEN v_fields := array_append(v_fields, 'work_date');      END IF;
    IF NEW.project_id     IS DISTINCT FROM OLD.project_id     THEN v_fields := array_append(v_fields, 'project_id');     END IF;
    IF NEW.project_name   IS DISTINCT FROM OLD.project_name   THEN v_fields := array_append(v_fields, 'project_name');   END IF;
    IF NEW.hours          IS DISTINCT FROM OLD.hours          THEN v_fields := array_append(v_fields, 'hours');          END IF;
    IF NEW.billable       IS DISTINCT FROM OLD.billable       THEN v_fields := array_append(v_fields, 'billable');       END IF;
    IF NEW.notes          IS DISTINCT FROM OLD.notes          THEN v_fields := array_append(v_fields, 'notes');          END IF;
    IF NEW.source         IS DISTINCT FROM OLD.source         THEN v_fields := array_append(v_fields, 'source');         END IF;
    IF NEW.status         IS DISTINCT FROM OLD.status         THEN v_fields := array_append(v_fields, 'status');         END IF;
    IF NEW.submitted_at   IS DISTINCT FROM OLD.submitted_at   THEN v_fields := array_append(v_fields, 'submitted_at');   END IF;
    IF NEW.approved_by    IS DISTINCT FROM OLD.approved_by    THEN v_fields := array_append(v_fields, 'approved_by');    END IF;
    IF NEW.approved_at    IS DISTINCT FROM OLD.approved_at    THEN v_fields := array_append(v_fields, 'approved_at');    END IF;
    IF NEW.reject_reason  IS DISTINCT FROM OLD.reject_reason  THEN v_fields := array_append(v_fields, 'reject_reason');  END IF;
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

-- Re-assert the trigger idempotently (identical to 019's definition). Not
-- strictly required — replacing the function is enough — but keeps the
-- migration self-healing if the trigger was ever dropped.
DROP TRIGGER IF EXISTS log_time_entry_audit ON time_entries;
CREATE TRIGGER log_time_entry_audit
  AFTER INSERT OR UPDATE OR DELETE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION log_time_entry_audit();
