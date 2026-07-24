-- Human dialer (browser softphone via Twilio Voice SDK).
-- One row per outbound call placed from the Dialer page. Unlike
-- candidate_calls (Vapi AI screening calls), these are human-to-human
-- calls: a dashboard user talks to a contact pulled from Salesforce /
-- ZoomInfo or a hand-typed number. Twilio webhooks (twilio-status,
-- twilio-recording) keep the row updated; post-call we transcribe with
-- Deepgram and extract AI notes with Claude.

CREATE TABLE IF NOT EXISTS dialer_calls (
  id                TEXT PRIMARY KEY,              -- nanoid, minted client-side before Device.connect()
  direction         TEXT NOT NULL DEFAULT 'outbound',
  -- Who we called
  to_phone          TEXT NOT NULL,                 -- E.164
  to_name           TEXT,
  to_title          TEXT,
  to_company        TEXT,
  contact_source    TEXT,                          -- 'salesforce' | 'zoominfo' | 'manual'
  contact_id        TEXT,                          -- SF Contact/Lead Id or ZI person id
  -- Who placed it
  placed_by         TEXT,                          -- dashboard user email
  caller_id         TEXT,                          -- Twilio number used as caller ID
  -- Twilio linkage
  provider          TEXT NOT NULL DEFAULT 'twilio',
  provider_call_sid TEXT,                          -- parent (browser leg) CallSid
  child_call_sid    TEXT,                          -- PSTN leg CallSid (from <Dial> status callbacks)
  -- Lifecycle: queued → ringing → in-progress → completed / no-answer / busy / failed / canceled
  status            TEXT NOT NULL DEFAULT 'queued',
  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  duration_sec      INTEGER,
  -- Recording + AI analysis
  recording_sid     TEXT,
  recording_url     TEXT,                          -- Twilio media URL (auth-gated; kept for reference)
  recording_path    TEXT,                          -- our copy in the call-recordings storage bucket
  transcript        TEXT,                          -- Deepgram diarized transcript, "Agent: …\nContact: …"
  ai_notes          JSONB,                         -- {summary, key_points[], action_items[], next_steps, sentiment, ...}
  ai_status         TEXT,                          -- null | 'transcribing' | 'analyzing' | 'done' | 'failed'
  -- Bookkeeping
  error_msg         TEXT,
  notes             TEXT,                          -- manual notes typed by the caller
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  updated_by        TEXT
);

CREATE INDEX IF NOT EXISTS idx_dialer_calls_created_at ON dialer_calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dialer_calls_provider_sid ON dialer_calls(provider_call_sid);
CREATE INDEX IF NOT EXISTS idx_dialer_calls_child_sid ON dialer_calls(child_call_sid);
CREATE INDEX IF NOT EXISTS idx_dialer_calls_placed_by ON dialer_calls(placed_by);

ALTER TABLE dialer_calls ENABLE ROW LEVEL SECURITY;

-- Same allowlist gate as the rest of the dashboard (008_auth_lockdown).
DROP POLICY IF EXISTS "authorized users all" ON dialer_calls;
CREATE POLICY "authorized users all" ON dialer_calls
  FOR ALL
  TO authenticated
  USING (is_authorized_user())
  WITH CHECK (is_authorized_user());

-- Private bucket for our own copies of call recordings (Twilio's URLs are
-- auth-gated; we mirror the mp3 so the UI can play it with a signed URL).
INSERT INTO storage.buckets (id, name, public)
VALUES ('call-recordings', 'call-recordings', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "authorized users read recordings" ON storage.objects;
CREATE POLICY "authorized users read recordings" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'call-recordings' AND is_authorized_user());
