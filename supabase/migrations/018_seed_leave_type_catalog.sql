-- Forward fix for the Leave page showing the wrong balance cards.
--
-- The Leave page renders one balance card per *active* row in `leave_types`.
-- Production is missing the standard active types and has a stray active
-- "Absent" pseudo-type, so employees see the wrong set of cards. Editing the
-- original seed in 016_leave_management.sql does NOT fix production — Supabase
-- records that migration as already applied and never re-runs it — so this NEW
-- migration idempotently reconciles the catalog and can be applied to the live
-- project to actually resolve the bug.
--
-- Catalog mirrors Zoho's THREE leave types (Casual and Sick are a SINGLE
-- combined type in Zoho, not two). Codes AL/CL are BEST-GUESS defaults — the
-- exact Zoho export codes are still being confirmed; admins can re-code these
-- from the Leave Types admin tab. COF is confirmed from Zoho. Quotas default to
-- 0 because per-employee allocations (leave_allocations) override the type
-- default when computing balances.
--
-- Idempotent: ON CONFLICT (code) DO UPDATE ensures the standard types exist,
-- are named correctly, and are active. Only quota/color/sort_order are left
-- untouched on conflict (admin adjustments to those are preserved); NOTE that
-- re-running resets name + active back to the values above, so an admin rename
-- or deliberate deactivation of AL/CL/COF would be reverted by a re-run.
-- Gender-gated leave types (Maternity / Paternity) also need an `eligibility`
-- column on leave_types. Added here so a fresh `supabase db reset` reproduces
-- the same schema; migration 019 adds it (and the MAT/PAT rows) to the LIVE DB.
ALTER TABLE leave_types
  ADD COLUMN IF NOT EXISTS eligibility TEXT NOT NULL DEFAULT 'all'
    CHECK (eligibility IN ('all','female','male'));

INSERT INTO leave_types (id, name, code, annual_quota, color, active, sort_order, eligibility) VALUES
  ('annual',    'Annual Leave/Privilege', 'AL',    0, '#2563eb', TRUE, 10, 'all'),
  ('casual',    'Casual/Sick Leave',      'CL',    0, '#16a34a', TRUE, 20, 'all'),
  ('comp_off',  'Compensatory Off',       'COF',   0, '#7c3aed', TRUE, 30, 'all'),
  ('maternity', 'Maternity Leave',        'MAT', 182, '#db2777', TRUE, 40, 'female'),
  ('paternity', 'Paternity Leave',        'PAT',  15, '#0d9488', TRUE, 50, 'male')
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name, active = TRUE, eligibility = EXCLUDED.eligibility;

-- Pseudo / non-leave placeholder types must never surface as balance cards.
UPDATE leave_types SET active = FALSE WHERE upper(code) IN ('ABSENT', 'ABS', 'LOP');
