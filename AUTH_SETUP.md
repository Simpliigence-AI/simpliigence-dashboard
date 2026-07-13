# Authentication setup

The dashboard now requires sign-in. This guide walks through the one-time
Supabase configuration so the auth flow works end-to-end.

## Architecture

- **Sign-in:** Supabase Auth — magic link (email) primary, Google OAuth optional
- **Authorization:** every dashboard table has an RLS policy that only
  permits users whose email appears in the `authorized_users` allowlist
  table. Adding/removing users is a one-line SQL command.
- **Sessions:** persisted in localStorage by Supabase, auto-refresh, survive
  reloads.

## One-time Supabase configuration

### 1. Set redirect URLs

Supabase needs to know where to send users after they click a magic link.

1. Supabase dashboard → **Authentication** → **URL Configuration**
2. **Site URL:** `https://simpliigence-ai.github.io/simpliigence-dashboard/`
3. **Redirect URLs** (add both):
   - `https://simpliigence-ai.github.io/simpliigence-dashboard/`
   - `http://localhost:5173/` (for local dev)

### 2. (Optional) Enable Google OAuth

Skip this if magic links are enough.

1. Supabase dashboard → **Authentication** → **Providers** → **Google**
2. Enable + paste in your Google OAuth Client ID + Secret (from Google Cloud
   Console → APIs & Services → Credentials → "Web application" client)
3. In your Google OAuth client config, add this Authorized redirect URI:
   `https://mhmxlubithnidopmkwgt.supabase.co/auth/v1/callback`

### 3. (Recommended) Restrict signups

For tighter control, prevent unknown emails from creating Supabase user
records in the first place.

- Supabase dashboard → **Authentication** → **Sign Up**
- Set **Allow new users to sign up** to **OFF**, then manually invite users
  via Authentication → Users → "Invite User".
- *Or* leave signups open — the allowlist below is the real gate; unknown
  users can sign in but the RLS policy returns empty data for them.

## Lock down the database

Until you run the lockdown migration, the anon key still grants full read +
write to the dashboard tables. To enforce auth:

1. Sign in to the dashboard at least once with the email you want as admin.
   This creates your `auth.users` row.
2. Open Supabase → **SQL Editor** → **New query**.
3. Paste the contents of `supabase/migrations/008_auth_lockdown.sql`.
4. **Edit the bootstrap INSERT at the bottom** of that file to use your
   actual email before running:
   ```sql
   INSERT INTO authorized_users (email, added_by, notes) VALUES
     ('raghu@simpliigence.com', 'bootstrap', 'admin'),
     ('teammate@simpliigence.com', 'raghu', 'finance');
   ```
5. Run it. Verify the policies switched:
   ```sql
   SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'Authorized users only';
   ```
   You should see all 16 dashboard tables listed.

## Day-to-day admin

### Add a user
```sql
INSERT INTO authorized_users (email, added_by, notes)
VALUES ('newperson@simpliigence.com', 'raghu', 'India Staffing lead');
```
Then tell them: "Open the dashboard, type your email, click the magic link
in your inbox."

### Remove a user
```sql
DELETE FROM authorized_users WHERE email = 'former@simpliigence.com';
```
Their existing session continues until token refresh (~1 hour), but the
RLS check immediately returns empty data on every fetch.

For instant lockout, also revoke their session:
- Supabase dashboard → Authentication → Users → find them → "..." → Delete user.

### See who's authorized
```sql
SELECT email, added_at, added_by, notes
FROM authorized_users
ORDER BY added_at;
```

### See who's signed in but not on the allowlist (helpful for setup)
```sql
SELECT u.email, u.last_sign_in_at
FROM auth.users u
LEFT JOIN authorized_users a ON LOWER(u.email) = LOWER(a.email)
WHERE a.email IS NULL
ORDER BY u.last_sign_in_at DESC;
```

## What users see

- **Not signed in:** the SignInPage (full-screen, branded). Type email →
  receive magic link → click → land back on the dashboard already
  authenticated.
- **Signed in & authorized:** the normal dashboard. Email + sign-out button
  appear at the bottom of the sidebar.
- **Signed in but NOT authorized:** the dashboard loads but every table is
  empty (RLS returns 0 rows). They can sign out and ask the admin for
  access. This is by design — we don't expose "you exist but aren't allowed"
  to avoid leaking the allowlist.

## Rolling back

If auth ever breaks and you need to bypass it temporarily:

```sql
-- Re-grant anon access to one specific table:
DROP POLICY IF EXISTS "Authorized users only" ON forecast_assignments;
CREATE POLICY "Allow all for anon" ON forecast_assignments
  FOR ALL USING (true) WITH CHECK (true);
```

Repeat per table, or run the inverse of migration 008. Don't forget to
re-lock when you're done.
