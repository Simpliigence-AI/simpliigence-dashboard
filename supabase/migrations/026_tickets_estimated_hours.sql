-- Estimated hours on concierge tickets.
--
-- The Tickets tab (Concierge page) tracks actual effort via
-- ticket_time_entries -> tickets.hours_logged. This adds a separate
-- planned/estimate value that admins set up-front on a ticket, so the
-- list can show "logged vs estimate" at a glance.
--
-- NOTE: the `tickets` table itself is not defined in these migrations —
-- it exists only in the live database (created alongside the desk-inbound
-- edge function). Run this in the Supabase SQL editor on the live project.
-- The UI is guarded to tolerate the column being absent (writes retry
-- without the field), but the estimate will not persist until this runs.
--
-- Nullable on purpose: most inbound (email) tickets will never get an
-- estimate, and the UI renders null as an em-dash.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(6,2);

COMMENT ON COLUMN tickets.estimated_hours IS
  'Planned effort in hours, set by admins. Distinct from hours_logged (actuals from ticket_time_entries).';
