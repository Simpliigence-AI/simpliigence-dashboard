-- Concierge 360 view — accounts, features (implemented + backlog), billing history.
-- Additive only. Idempotent. Authorized-users lockdown (from 008).
-- The existing ConciergeTicket store (Zoho Desk sync) is unchanged; it joins to
-- concierge_accounts by name.

CREATE TABLE IF NOT EXISTS concierge_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  billing_model TEXT NOT NULL DEFAULT 'monthly_retainer',
    -- 'monthly_retainer' | 'annual_unlimited' | 'hourly'
  monthly_rate NUMERIC,
  contract_start TEXT,           -- YYYY-MM-DD
  contract_end TEXT,             -- YYYY-MM-DD
  health TEXT NOT NULL DEFAULT 'green',    -- 'green' | 'yellow' | 'red'
  owner_email TEXT,
  tech_stack JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_work TEXT,
  previous_work TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_concierge_accounts_health ON concierge_accounts(health);
CREATE INDEX IF NOT EXISTS idx_concierge_accounts_owner ON concierge_accounts(owner_email);

CREATE TABLE IF NOT EXISTS concierge_features (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES concierge_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_implemented',
    -- 'implemented' | 'in_progress' | 'planned' | 'not_implemented'
  priority TEXT NOT NULL DEFAULT 'medium',   -- 'high' | 'medium' | 'low'
  upsell_estimate NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_concierge_features_account ON concierge_features(account_id);
CREATE INDEX IF NOT EXISTS idx_concierge_features_status ON concierge_features(status);

CREATE TABLE IF NOT EXISTS concierge_billing (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES concierge_accounts(id) ON DELETE CASCADE,
  month TEXT NOT NULL,           -- YYYY-MM
  amount NUMERIC NOT NULL DEFAULT 0,
  hours NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, month)
);

CREATE INDEX IF NOT EXISTS idx_concierge_billing_account ON concierge_billing(account_id);
CREATE INDEX IF NOT EXISTS idx_concierge_billing_month ON concierge_billing(month);

-- Realtime publication
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'concierge_accounts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE concierge_accounts;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'concierge_features') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE concierge_features;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'concierge_billing') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE concierge_billing;
  END IF;
END$$;

-- RLS — authorized users only
ALTER TABLE concierge_accounts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE concierge_features  ENABLE ROW LEVEL SECURITY;
ALTER TABLE concierge_billing   ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='concierge_accounts' AND policyname='Authorized users only') THEN
    CREATE POLICY "Authorized users only" ON concierge_accounts FOR ALL TO authenticated USING (is_authorized_user()) WITH CHECK (is_authorized_user());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='concierge_features' AND policyname='Authorized users only') THEN
    CREATE POLICY "Authorized users only" ON concierge_features FOR ALL TO authenticated USING (is_authorized_user()) WITH CHECK (is_authorized_user());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='concierge_billing' AND policyname='Authorized users only') THEN
    CREATE POLICY "Authorized users only" ON concierge_billing FOR ALL TO authenticated USING (is_authorized_user()) WITH CHECK (is_authorized_user());
  END IF;
END$$;

-- updated_at trigger reuse
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='touch_updated_at') THEN
    DROP TRIGGER IF EXISTS concierge_accounts_touch ON concierge_accounts;
    CREATE TRIGGER concierge_accounts_touch BEFORE UPDATE ON concierge_accounts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    DROP TRIGGER IF EXISTS concierge_features_touch ON concierge_features;
    CREATE TRIGGER concierge_features_touch BEFORE UPDATE ON concierge_features FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    DROP TRIGGER IF EXISTS concierge_billing_touch ON concierge_billing;
    CREATE TRIGGER concierge_billing_touch BEFORE UPDATE ON concierge_billing FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END$$;
