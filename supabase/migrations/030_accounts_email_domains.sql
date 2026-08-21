-- Declare accounts.email_domains in the repo.
--
-- desk-inbound routes an inbound email to an account by matching the sender's
-- domain against this array (`.contains('email_domains', [domain])`), and
-- AccountsPage lets an admin edit it. Both have shipped for a while, so the
-- column is expected to be present in the live database already — but nothing
-- in `supabase/migrations/` ever created it, and the "GIN index makes this
-- fast" comment in desk-inbound referred to an index that exists nowhere in
-- this repo. That combination is how the routing could fail silently: the
-- query errors, desk-inbound (until now) discarded the error, and every
-- sender fell through to `Others`. desk-inbound now logs that error; this
-- migration makes the schema it needs explicit and reproducible.
--
-- Written to be a no-op when the column and index already exist, and to skip
-- cleanly on a database where `accounts` itself has not been created yet
-- (`ALTER TABLE IF EXISTS`).

ALTER TABLE IF EXISTS accounts
  ADD COLUMN IF NOT EXISTS email_domains TEXT[] NOT NULL DEFAULT '{}'::text[];

-- The lookup is a containment test on an array, which is exactly what GIN
-- indexes. Guarded so it is skipped if `accounts` does not exist yet.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'accounts'
               AND column_name = 'email_domains')
  THEN
    CREATE INDEX IF NOT EXISTS idx_accounts_email_domains
      ON accounts USING GIN (email_domains);

    COMMENT ON COLUMN accounts.email_domains IS
      'Sending domains that route inbound desk email to this account, lowercase, no @ (e.g. {acme.com,acme-inc.com}). Matched exactly by the desk-inbound edge function; free-mail domains are ignored there on purpose.';
  END IF;
END $$;
