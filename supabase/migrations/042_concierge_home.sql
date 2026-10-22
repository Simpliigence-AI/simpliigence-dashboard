-- 042 — Concierge Home
--
-- The Home tab on /concierge reads:
--   v_concierge_home_accounts   one row per active (non-dormant) concierge account, every signal
--   v_concierge_home_tickets    open tickets with their follow-up flags
--   v_concierge_calendar_events client meetings matched to a concierge account
-- Calendar invites come from the same Outlook sync as Delivery Home (delivery-calendar edge
-- function → delivery_calendar_events). An invite is matched to a concierge account by the
-- account name / keywords in the subject, or by an attendee from a client domain — domains
-- are learned from the account's ticket senders, plus any added by hand.
-- Concierge mailboxes (ticket assignees in the last 90 days + account owners) are added to
-- the calendar sync as kind 'concierge'.
-- Thresholds live in concierge_home_settings (one row) and are editable on the page.
-- Views are SECURITY DEFINER with has_tab('concierge','view') inside.

-- ── Settings ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS concierge_home_settings (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  billing_floor numeric NOT NULL DEFAULT 1000,   -- USD this month; below it is flagged
  quiet_days    integer NOT NULL DEFAULT 15,     -- no ticket raised in this many days is flagged
  stale_days    integer NOT NULL DEFAULT 7,      -- open ticket with no activity in this many days is flagged
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);
INSERT INTO concierge_home_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE concierge_home_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tab: concierge" ON concierge_home_settings;
CREATE POLICY "tab: concierge" ON concierge_home_settings FOR SELECT TO authenticated USING (has_tab('concierge','view'));
REVOKE ALL ON concierge_home_settings FROM anon;
GRANT SELECT ON concierge_home_settings TO authenticated;

CREATE OR REPLACE FUNCTION concierge_home_set_settings(p_billing_floor numeric, p_quiet_days integer, p_stale_days integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT has_tab('concierge','edit') THEN RAISE EXCEPTION 'You need edit access to Concierge.' USING errcode = '42501'; END IF;
  UPDATE concierge_home_settings SET
    billing_floor = greatest(coalesce(p_billing_floor, billing_floor), 0),
    quiet_days    = greatest(coalesce(p_quiet_days, quiet_days), 1),
    stale_days    = greatest(coalesce(p_stale_days, stale_days), 1),
    updated_at = now(), updated_by = delivery_actor()
  WHERE id = 1;
END $$;
REVOKE ALL ON FUNCTION concierge_home_set_settings(numeric,integer,integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION concierge_home_set_settings(numeric,integer,integer) TO authenticated;

-- ── Calendar matching ───────────────────────────────────────────────────
ALTER TABLE concierge_accounts ADD COLUMN IF NOT EXISTS calendar_keywords text[] NOT NULL DEFAULT '{}';
ALTER TABLE concierge_accounts ADD COLUMN IF NOT EXISTS client_domains    text[] NOT NULL DEFAULT '{}';
ALTER TABLE delivery_calendar_events ADD COLUMN IF NOT EXISTS concierge_account_id text REFERENCES concierge_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS delivery_calendar_events_concierge ON delivery_calendar_events (concierge_account_id, start_at);

ALTER TABLE delivery_calendar_mailboxes DROP CONSTRAINT IF EXISTS delivery_calendar_mailboxes_kind_check;
ALTER TABLE delivery_calendar_mailboxes ADD CONSTRAINT delivery_calendar_mailboxes_kind_check CHECK (kind IN ('core','team','concierge'));

-- Client domains per account: hand-entered + learned from ticket senders.
CREATE OR REPLACE VIEW v_concierge_account_domains WITH (security_invoker = false) AS
WITH generic(d) AS (VALUES ('gmail.com'),('outlook.com'),('hotmail.com'),('yahoo.com'),('icloud.com'),('live.com'),('aol.com'),('msn.com'),('me.com'),('simpliigence.com'),('salesforce.com'),('microsoft.com'))
SELECT a.id AS account_id, d.domain
FROM concierge_accounts a
CROSS JOIN LATERAL (
  SELECT lower(btrim(x)) AS domain FROM unnest(a.client_domains) x
  UNION
  SELECT lower(split_part(t.sender_email,'@',2)) FROM tickets t
   WHERE lower(btrim(t.account)) = lower(btrim(a.name)) AND t.sender_email LIKE '%@%'
  UNION
  SELECT lower(split_part(m.from_email,'@',2)) FROM tickets t JOIN ticket_messages m ON m.ticket_id = t.id
   WHERE lower(btrim(t.account)) = lower(btrim(a.name)) AND m.direction = 'inbound' AND m.from_email LIKE '%@%'
) d
WHERE d.domain <> '' AND d.domain NOT IN (SELECT d FROM generic);
REVOKE ALL ON v_concierge_account_domains FROM anon;
GRANT SELECT ON v_concierge_account_domains TO authenticated, service_role;

-- Re-match every calendar event to a concierge account. Name in subject 3, keyword 4,
-- client-domain attendee 4; a tie stays unmatched.
CREATE OR REPLACE FUNCTION concierge_calendar_rematch() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  WITH ev AS (
    SELECT e.id, e.subject,
           (SELECT coalesce(array_agg(DISTINCT lower(split_part(x->>'email','@',2))), '{}') FROM jsonb_array_elements(e.attendees) x
             WHERE x->>'email' LIKE '%@%') AS doms
    FROM delivery_calendar_events e
  ), s AS (
    SELECT ev.id AS event_id, a.id AS account_id,
      (CASE WHEN length(a.name) >= 4 AND ev.subject ILIKE '%' || a.name || '%' THEN 3 ELSE 0 END)
      + (CASE WHEN EXISTS (SELECT 1 FROM unnest(a.calendar_keywords) k WHERE length(k) >= 3 AND ev.subject ILIKE '%' || k || '%') THEN 4 ELSE 0 END)
      + (CASE WHEN EXISTS (SELECT 1 FROM v_concierge_account_domains d WHERE d.account_id = a.id AND d.domain = ANY (ev.doms)) THEN 4 ELSE 0 END) AS score
    FROM ev CROSS JOIN concierge_accounts a
    WHERE NOT a.is_dormant
  ), best AS (
    SELECT DISTINCT ON (event_id) event_id, account_id, score,
           count(*) OVER (PARTITION BY event_id, score) AS ties
    FROM s WHERE score > 0 ORDER BY event_id, score DESC
  ), pick AS (
    SELECT e.id, CASE WHEN b.ties = 1 THEN b.account_id END AS account_id
    FROM delivery_calendar_events e LEFT JOIN best b ON b.event_id = e.id
  )
  UPDATE delivery_calendar_events e SET concierge_account_id = p.account_id
  FROM pick p WHERE p.id = e.id AND e.concierge_account_id IS DISTINCT FROM p.account_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION concierge_calendar_rematch() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION concierge_calendar_rematch() TO service_role;

-- Concierge people's calendars join the sync: ticket assignees (90 days) + account owners.
CREATE OR REPLACE FUNCTION concierge_calendar_refresh_mailboxes() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  WITH people AS (
    SELECT DISTINCT lower(btrim(e)) AS email FROM (
      SELECT assignee_email e FROM tickets WHERE coalesce(updated_at, created_time) > now() - interval '90 days'
      UNION SELECT owner_email FROM concierge_accounts WHERE NOT is_dormant
    ) x WHERE e LIKE '%@simpliigence.com'
  )
  INSERT INTO delivery_calendar_mailboxes (email, name, kind, active)
  SELECT p.email, (SELECT full_name FROM authorized_users u WHERE lower(u.email) = p.email LIMIT 1), 'concierge', true FROM people p
  ON CONFLICT (email) DO UPDATE SET active = true,
    kind = CASE WHEN delivery_calendar_mailboxes.active THEN delivery_calendar_mailboxes.kind ELSE 'concierge' END,
    updated_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION concierge_calendar_refresh_mailboxes() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION concierge_calendar_refresh_mailboxes() TO service_role;

-- Concierge users may not hold Project Plans, so they read calendar events through this view.
CREATE OR REPLACE VIEW v_concierge_calendar_events WITH (security_invoker = false) AS
SELECT e.id, e.subject, e.start_at, e.end_at, e.is_all_day, e.is_cancelled, e.organizer, e.organizer_name,
       e.attendees, e.join_url, e.web_link, e.location, e.is_external, e.concierge_account_id, a.name AS account_name
FROM delivery_calendar_events e JOIN concierge_accounts a ON a.id = e.concierge_account_id
WHERE has_tab('concierge','view');
REVOKE ALL ON v_concierge_calendar_events FROM anon;
GRANT SELECT ON v_concierge_calendar_events TO authenticated;

-- ── Home: open tickets with follow-up flags ─────────────────────────────
CREATE OR REPLACE VIEW v_concierge_home_tickets WITH (security_invoker = false) AS
WITH cfg AS (SELECT * FROM concierge_home_settings WHERE id = 1)
SELECT t.id, t.ticket_number, t.subject, t.status, t.priority, t.account, a.id AS account_id,
       t.assignee_email, t.estimated_hours, t.hours_logged, t.created_time, t.due_date,
       act.last_activity_at,
       (t.estimated_hours IS NULL OR t.estimated_hours = 0) AS no_estimate,
       (nullif(btrim(t.assignee_email),'') IS NULL) AS unassigned,
       (act.last_activity_at < now() - make_interval(days => cfg.stale_days)) AS stalled,
       (t.due_date < now()) AS overdue,
       extract(day FROM now() - act.last_activity_at)::int AS idle_days
FROM tickets t
CROSS JOIN cfg
LEFT JOIN concierge_accounts a ON lower(btrim(a.name)) = lower(btrim(t.account))
CROSS JOIN LATERAL (SELECT greatest(t.created_time, t.updated_at,
    (SELECT max(logged_at) FROM ticket_time_entries x WHERE x.ticket_id = t.id),
    (SELECT max(coalesce(received_at, created_at)) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.direction <> 'inbound')) AS last_activity_at) act
WHERE t.status IN ('Open','On Hold','Escalated')
  AND has_tab('concierge','view');
REVOKE ALL ON v_concierge_home_tickets FROM anon;
GRANT SELECT ON v_concierge_home_tickets TO authenticated;

-- ── Home: one row per active account ────────────────────────────────────
-- Billing this month mirrors the Billing tab: fixed = stored concierge_fixed_billing row, else
-- monthly_rate for retainer / annual accounts; T&M = est. hours on tickets billed this month ×
-- rate, hourly accounts only.
CREATE OR REPLACE VIEW v_concierge_home_accounts WITH (security_invoker = false) AS
WITH cfg AS (SELECT * FROM concierge_home_settings WHERE id = 1),
mon AS (SELECT to_char(now(), 'YYYY-MM') AS m),
acc AS (SELECT * FROM concierge_accounts WHERE NOT is_dormant),
tk AS (
  SELECT a.id AS ca_id, t.*,
         coalesce(t.billing_month, to_char(t.created_time, 'YYYY-MM')) AS bill_month
  FROM acc a JOIN tickets t ON lower(btrim(t.account)) = lower(btrim(a.name))
), agg AS (
  SELECT a.id,
    count(tk.id) FILTER (WHERE tk.status IN ('Open','On Hold','Escalated')) AS open_tickets,
    count(tk.id) FILTER (WHERE tk.created_time >= now() - make_interval(days => (SELECT quiet_days FROM cfg))) AS recent_tickets,
    max(tk.created_time) AS last_ticket_at,
    coalesce(sum(tk.estimated_hours) FILTER (WHERE tk.bill_month = (SELECT m FROM mon)), 0) AS month_est_hours
  FROM acc a LEFT JOIN tk ON tk.ca_id = a.id GROUP BY a.id
), flags AS (
  SELECT account_id, count(*) FILTER (WHERE no_estimate) AS no_estimate, count(*) FILTER (WHERE unassigned) AS unassigned,
         count(*) FILTER (WHERE stalled) AS stalled
  FROM v_concierge_home_tickets WHERE account_id IS NOT NULL GROUP BY 1
), cal AS (
  SELECT a.id,
    count(e.id) FILTER (WHERE e.end_at < now() AND e.end_at >= now() - interval '30 days') AS held_30d,
    max(e.end_at) FILTER (WHERE e.end_at < now()) AS last_meeting_at,
    min(e.start_at) FILTER (WHERE e.start_at >= now()) AS next_meeting_at,
    count(e.id) FILTER (WHERE e.start_at >= now() AND e.start_at < now() + interval '14 days') AS upcoming_14d
  FROM acc a LEFT JOIN delivery_calendar_events e ON e.concierge_account_id = a.id AND NOT e.is_cancelled GROUP BY a.id
), bill AS (
  SELECT a.id,
    CASE WHEN a.billing_model = 'hourly' THEN 0 ELSE coalesce(fb.amount, a.monthly_rate, 0) END
      + CASE WHEN a.billing_model = 'hourly' THEN coalesce(fb.amount, 0) ELSE 0 END AS fixed_amount,
    CASE WHEN a.billing_model = 'hourly' THEN coalesce(g.month_est_hours, 0) * coalesce(a.monthly_rate, 0) ELSE 0 END AS tm_amount
  FROM acc a
  LEFT JOIN agg g ON g.id = a.id
  LEFT JOIN concierge_fixed_billing fb ON lower(btrim(fb.account_name)) = lower(btrim(a.name)) AND fb.month = (SELECT m FROM mon)
)
SELECT a.id, a.name, a.billing_model, a.monthly_rate, a.health, a.owner_email,
       g.open_tickets, g.recent_tickets, g.last_ticket_at, g.month_est_hours,
       (g.recent_tickets = 0) AS quiet,
       coalesce(f.no_estimate, 0) AS no_estimate, coalesce(f.unassigned, 0) AS unassigned, coalesce(f.stalled, 0) AS stalled,
       b.fixed_amount, b.tm_amount, b.fixed_amount + b.tm_amount AS month_billing,
       (b.fixed_amount + b.tm_amount) < (SELECT billing_floor FROM cfg) AS below_floor,
       c.held_30d, c.last_meeting_at, c.next_meeting_at, c.upcoming_14d,
       (c.upcoming_14d = 0) AS no_upcoming_meeting,
       (SELECT m FROM mon) AS billing_month,
       (SELECT billing_floor FROM cfg) AS billing_floor, (SELECT quiet_days FROM cfg) AS quiet_days, (SELECT stale_days FROM cfg) AS stale_days
FROM acc a
JOIN agg g ON g.id = a.id
JOIN bill b ON b.id = a.id
JOIN cal c ON c.id = a.id
LEFT JOIN flags f ON f.account_id = a.id
WHERE has_tab('concierge','view');
REVOKE ALL ON v_concierge_home_accounts FROM anon;
GRANT SELECT ON v_concierge_home_accounts TO authenticated;

-- Every calendar ingest also re-matches concierge accounts; mailboxes refresh hourly.
DO $d$
DECLARE f text := pg_get_functiondef('delivery_calendar_ingest(text,timestamptz,timestamptz,jsonb)'::regprocedure);
BEGIN
  IF position('concierge_calendar_rematch' in f) = 0 THEN
    f := replace(f, 'PERFORM delivery_calendar_rematch();', 'PERFORM delivery_calendar_rematch();' || E'\n  PERFORM concierge_calendar_rematch();');
    EXECUTE f;
  END IF;
END $d$;
DO $$
BEGIN
  PERFORM cron.unschedule('concierge-calendar-mailboxes') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'concierge-calendar-mailboxes');
  PERFORM cron.schedule('concierge-calendar-mailboxes', '5 * * * *', 'SELECT concierge_calendar_refresh_mailboxes()');
END $$;
SELECT concierge_calendar_refresh_mailboxes(), concierge_calendar_rematch();

-- Invites whose subject starts "Canceled:" are cancelled even when the attendee's copy isn't flagged.
DO $d$
DECLARE f text := pg_get_functiondef('delivery_calendar_ingest(text,timestamptz,timestamptz,jsonb)'::regprocedure);
BEGIN
  IF position('cancel+ed' in f) = 0 THEN
    f := replace(f, $$coalesce((x->>'cancelled')::boolean,false), lower(x->>'organizer')$$,
                    $$(coalesce((x->>'cancelled')::boolean,false) OR coalesce(x->>'subject','') ~* '^\s*cancel+ed\s*:'), lower(x->>'organizer')$$);
    EXECUTE f;
  END IF;
END $d$;
UPDATE delivery_calendar_events SET is_cancelled = true WHERE NOT is_cancelled AND subject ~* '^\s*cancel+ed\s*:';
