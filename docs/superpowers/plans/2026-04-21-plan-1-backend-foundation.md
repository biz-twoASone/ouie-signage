# Plan 1: Backend Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Supabase-hosted backend — schema, RLS, device auth, and all Edge Functions needed for TVs to pair, authenticate, sync config/media, heartbeat, and receive "Sync Now" pushes. Produces a fully testable API with no dashboard or TV client yet.

**Architecture:** Supabase (Postgres + Edge Functions on Deno) + Cloudflare R2 for media object storage + Firebase Cloud Messaging for push. Humans access tables via RLS tied to `auth.uid()`; devices access via Edge Functions that verify custom JWTs and apply tenant filtering with service-role. Media upload/download via presigned R2 URLs minted by Edge Functions.

**Tech Stack:**
- Supabase CLI (local dev via Docker, remote via linked project)
- Postgres 15+ (Supabase default)
- Deno runtime for Edge Functions
- `pgtap` for database tests
- Deno's built-in test runner for Edge Function tests (`deno test`)
- `djwt` (https://deno.land/x/djwt) for JWT mint/verify
- `aws4fetch` for S3-compatible presigned URL generation against Cloudflare R2
- Google OAuth2 + Firebase HTTP v1 API for FCM sending

**Spec reference:** `docs/superpowers/specs/2026-04-21-signage-v1-design.md`

**Plan position:** 1 of 5. Unblocks Plans 2 (dashboard), 3a/b/c (Android TV app).

---

## File structure

```
supabase/
├── config.toml                                  # Supabase project config
├── migrations/
│   ├── 20260421000100_extensions.sql
│   ├── 20260421000200_tenants.sql
│   ├── 20260421000300_stores.sql
│   ├── 20260421000400_devices.sql
│   ├── 20260421000500_device_groups.sql
│   ├── 20260421000600_media.sql
│   ├── 20260421000700_playlists.sql
│   ├── 20260421000800_dayparting_rules.sql
│   ├── 20260421000900_pairing_requests.sql
│   ├── 20260421001000_indexes.sql
│   ├── 20260421001100_rls_enable.sql
│   └── 20260421001200_rls_policies.sql
├── tests/
│   ├── schema.test.sql                          # smoke: all tables/columns present
│   ├── rls_isolation.test.sql                   # CRITICAL: cross-tenant leak checks
│   └── constraints.test.sql                     # CHECKs fire as expected
├── functions/
│   ├── _shared/
│   │   ├── jwt.ts                               # mint/verify device JWTs
│   │   ├── r2.ts                                # presigned URL helper
│   │   ├── fcm.ts                               # FCM HTTP v1 sender
│   │   ├── supabase.ts                          # service-role client factory
│   │   └── auth.ts                              # extract+verify device from Authorization header
│   ├── pairing-request/index.ts
│   ├── pairing-claim/index.ts
│   ├── pairing-status/index.ts
│   ├── devices-refresh/index.ts
│   ├── devices-config/index.ts
│   ├── devices-heartbeat/index.ts
│   ├── devices-cache-status/index.ts
│   └── devices-sync-now/index.ts
└── functions/tests/
    ├── pairing.test.ts
    ├── refresh.test.ts
    ├── config.test.ts
    ├── heartbeat.test.ts
    ├── cache_status.test.ts
    ├── sync_now.test.ts
    └── e2e.test.ts                              # full pairing → config → heartbeat flow
```

---

## Pre-work: manual setup (before starting tasks)

These steps require human actions that can't be automated. Complete them first.

1. **Install Supabase CLI** on dev machine.
   - macOS: `brew install supabase/tap/supabase`
   - Verify: `supabase --version` should print a version.

2. **Install Deno** (for running Edge Function tests locally).
   - macOS: `brew install deno`
   - Verify: `deno --version`

3. **Create a Cloudflare R2 account & bucket.**
   - Sign up at https://dash.cloudflare.com/ if needed.
   - Create bucket named `signage-media` (any name works, use consistently).
   - Create an R2 API token with read+write scope for this bucket.
   - Save: **R2 account ID**, **R2 access key ID**, **R2 secret access key**, **R2 endpoint URL** (`https://<account>.r2.cloudflarestorage.com`), **R2 bucket name**.

4. **Create a Firebase project for FCM.**
   - https://console.firebase.google.com/ → new project (any name).
   - In project settings → Service Accounts → Generate new private key (JSON).
   - Save the JSON file securely; you'll paste its contents into a Supabase secret.
   - Note the **Firebase project ID**.

5. **Create a Supabase project.**
   - https://supabase.com/ → new project (region: Singapore / `ap-southeast-1` for Jakarta latency).
   - Save: **project ref** (from URL), **DB password**, **anon key**, **service role key**, **JWT secret** (Settings → API → JWT Settings).

6. **Docker** must be running locally for `supabase start` (local stack).

Once all six are done, proceed to Task 1.

---

## Task 1: Initialize Supabase project

**Files:**
- Create: `supabase/config.toml` (via CLI)
- Create: `.env.local` (for your local secrets; gitignored)
- Create: `.env.example` (template, committed)

- [ ] **Step 1: Initialize Supabase in the repo**

From repo root:
```bash
supabase init
```

Expected output: `Finished supabase init.` and `supabase/` directory created.

- [ ] **Step 2: Start local Supabase stack**

```bash
supabase start
```

Expected output (abbreviated):
```
         API URL: http://127.0.0.1:54321
          DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
      Studio URL: http://127.0.0.1:54323
    ...
      JWT secret: super-secret-jwt-token-with-at-least-32-characters-long
      anon key: eyJh...
 service_role key: eyJh...
```

Copy these values — you'll need them for env files.

- [ ] **Step 3: Create `.env.example`**

```bash
cat > .env.example <<'EOF'
# Supabase (local dev defaults shown; replace with remote values for prod)
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=signage-media
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_PUBLIC_BASE=

# Firebase (paste full JSON on one line, escaped)
FCM_SERVICE_ACCOUNT_JSON=
FCM_PROJECT_ID=
EOF
```

- [ ] **Step 4: Create `.env.local` with your local values**

Copy `.env.example` to `.env.local` and fill in values from step 2 (for Supabase) and from pre-work (R2, FCM). `.env.local` is already gitignored.

- [ ] **Step 5: Commit**

```bash
git add supabase/config.toml .env.example
git commit -m "chore: initialize supabase project"
```

---

## Task 2: Base migration — enable required extensions

**Files:**
- Create: `supabase/migrations/20260421000100_extensions.sql`

- [ ] **Step 1: Create migration file**

```bash
# Using a deterministic timestamp to match the plan's filenames:
mkdir -p supabase/migrations
cat > supabase/migrations/20260421000100_extensions.sql <<'EOF'
-- Extensions required by later migrations and tests
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgtap";      -- used in supabase/tests/*.test.sql
EOF
```

- [ ] **Step 2: Apply and verify**

```bash
supabase db reset
```

Expected: `Finished supabase db reset` and no errors. `pgcrypto` and `pgtap` extensions exist.

Verify manually:
```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto', 'pgtap') ORDER BY extname;"
```
Expected output:
```
 extname
----------
 pgcrypto
 pgtap
(2 rows)
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421000100_extensions.sql
git commit -m "feat(db): enable pgcrypto and pgtap extensions"
```

---

## Task 3: Migration — tenants + tenant_members

**Files:**
- Create: `supabase/migrations/20260421000200_tenants.sql`

- [ ] **Step 1: Create migration**

```sql
-- supabase/migrations/20260421000200_tenants.sql
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_members (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','admin','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
```

Write this to `supabase/migrations/20260421000200_tenants.sql`.

- [ ] **Step 2: Apply and verify**

```bash
supabase db reset
```
Expected: no errors.

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\dt public.tenant*"
```
Expected output:
```
            List of relations
 Schema |      Name       | Type  |  Owner
--------+-----------------+-------+---------
 public | tenant_members  | table | postgres
 public | tenants         | table | postgres
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421000200_tenants.sql
git commit -m "feat(db): add tenants and tenant_members"
```

---

## Task 4: Migration — stores

**Files:**
- Create: `supabase/migrations/20260421000300_stores.sql`

- [ ] **Step 1: Create migration**

```sql
-- supabase/migrations/20260421000300_stores.sql
CREATE TABLE stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  sync_window_start time NOT NULL DEFAULT '02:00',
  sync_window_end time NOT NULL DEFAULT '05:00',
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Write to `supabase/migrations/20260421000300_stores.sql`.

- [ ] **Step 2: Apply and verify**

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\d stores"
```
Expected: shows all columns with correct types.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421000300_stores.sql
git commit -m "feat(db): add stores table with sync window defaults"
```

---

## Task 5: Migration — devices (full schema including auth + cache info)

**Files:**
- Create: `supabase/migrations/20260421000400_devices.sql`

- [ ] **Step 1: Create migration**

```sql
-- supabase/migrations/20260421000400_devices.sql
CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id),
  name text NOT NULL,

  -- Pairing
  pairing_code text,              -- rarely used post-pair; kept for auditing
  paired_at timestamptz,

  -- Rotating refresh-token auth
  refresh_token_hash text,         -- sha256 hex of current refresh token
  refresh_token_issued_at timestamptz,
  refresh_token_last_used_at timestamptz,
  access_token_ttl_seconds int NOT NULL DEFAULT 3600,

  -- FCM
  fcm_token text,

  -- Playback
  fallback_playlist_id uuid,       -- FK added later (forward ref to playlists)

  -- Health
  last_seen_at timestamptz,
  cache_storage_info jsonb,

  -- Lifecycle
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Write to `supabase/migrations/20260421000400_devices.sql`.

- [ ] **Step 2: Apply and verify**

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\d devices"
```
Expected: table exists with all columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421000400_devices.sql
git commit -m "feat(db): add devices table with rotation and cache fields"
```

---

## Task 6: Migration — device_groups + device_group_members

**Files:**
- Create: `supabase/migrations/20260421000500_device_groups.sql`

- [ ] **Step 1: Create migration**

```sql
-- supabase/migrations/20260421000500_device_groups.sql
CREATE TABLE device_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE device_group_members (
  device_group_id uuid NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_group_id, device_id)
);
```

- [ ] **Step 2: Apply and verify**

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\dt device_*"
```
Expected: both tables present.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421000500_device_groups.sql
git commit -m "feat(db): add device_groups with M:N membership"
```

---

## Task 7: Migration — media

**Files:**
- Create: `supabase/migrations/20260421000600_media.sql`

- [ ] **Step 1: Create migration**

```sql
-- supabase/migrations/20260421000600_media.sql
CREATE TABLE media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('video', 'image')),
  r2_path text NOT NULL,
  original_filename text,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  checksum text NOT NULL,                       -- sha256 hex
  video_duration_seconds numeric,               -- null for images
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'image' AND video_duration_seconds IS NULL)
    OR (kind = 'video' AND video_duration_seconds IS NOT NULL AND video_duration_seconds > 0)
  )
);
```

- [ ] **Step 2: Apply and verify**

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\d media"
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421000600_media.sql
git commit -m "feat(db): add media table with kind/duration consistency check"
```

---

## Task 8: Migration — playlists + playlist_items + devices FK

**Files:**
- Create: `supabase/migrations/20260421000700_playlists.sql`

- [ ] **Step 1: Create migration**

```sql
-- supabase/migrations/20260421000700_playlists.sql
CREATE TABLE playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE playlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media(id),
  position int NOT NULL CHECK (position >= 0),
  duration_seconds numeric CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  UNIQUE (playlist_id, position)
);

-- Resolve the forward FK from devices.fallback_playlist_id now that playlists exists:
ALTER TABLE devices
  ADD CONSTRAINT devices_fallback_playlist_fk
  FOREIGN KEY (fallback_playlist_id) REFERENCES playlists(id) ON DELETE SET NULL;

-- Keep playlists.updated_at current when items change:
CREATE OR REPLACE FUNCTION bump_playlist_updated_at() RETURNS trigger AS $$
BEGIN
  UPDATE playlists SET updated_at = now() WHERE id = COALESCE(NEW.playlist_id, OLD.playlist_id);
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

CREATE TRIGGER playlist_items_bump_updated
  AFTER INSERT OR UPDATE OR DELETE ON playlist_items
  FOR EACH ROW EXECUTE FUNCTION bump_playlist_updated_at();
```

- [ ] **Step 2: Apply and verify**

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\d playlists"
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\d playlist_items"
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\d devices" | grep fallback_playlist
```
Expected: both tables exist, devices now has the `devices_fallback_playlist_fk` constraint.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421000700_playlists.sql
git commit -m "feat(db): add playlists, playlist_items, devices.fallback_playlist FK"
```

---

## Task 9: Migration — dayparting_rules with single-target constraint

**Files:**
- Create: `supabase/migrations/20260421000800_dayparting_rules.sql`

- [ ] **Step 1: Create migration**

```sql
-- supabase/migrations/20260421000800_dayparting_rules.sql
CREATE TABLE dayparting_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  playlist_id uuid NOT NULL REFERENCES playlists(id),

  -- Exactly one target type. XOR enforced via CHECK.
  target_device_id uuid REFERENCES devices(id) ON DELETE CASCADE,
  target_device_group_id uuid REFERENCES device_groups(id) ON DELETE CASCADE,
  CONSTRAINT rule_single_target CHECK (
    (target_device_id IS NOT NULL)::int + (target_device_group_id IS NOT NULL)::int = 1
  ),

  -- Rule timing (evaluated against device.store.timezone)
  days_of_week int[] NOT NULL
    CHECK (array_length(days_of_week, 1) BETWEEN 1 AND 7
           AND days_of_week <@ ARRAY[1,2,3,4,5,6,7]),
  start_time time NOT NULL,
  end_time time NOT NULL,
  -- Note: end_time < start_time means crosses midnight; valid.

  effective_at timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
```

- [ ] **Step 2: Apply and verify**

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\d dayparting_rules"
```
Expected: table present, CHECK constraint visible.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421000800_dayparting_rules.sql
git commit -m "feat(db): add dayparting_rules with single-target XOR constraint"
```

---

## Task 10: Migration — pairing_requests

**Files:**
- Create: `supabase/migrations/20260421000900_pairing_requests.sql`

- [ ] **Step 1: Create migration**

```sql
-- supabase/migrations/20260421000900_pairing_requests.sql
CREATE TABLE pairing_requests (
  code text PRIMARY KEY,
  device_proposed_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  claimed_device_id uuid REFERENCES devices(id) ON DELETE SET NULL,

  -- Rate-limit bucket (simple per-source column; IPs recorded by Edge Function)
  created_from_ip inet
);
```

- [ ] **Step 2: Apply and verify**

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\d pairing_requests"
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421000900_pairing_requests.sql
git commit -m "feat(db): add pairing_requests short-lived codes"
```

---

## Task 11: Migration — indexes

**Files:**
- Create: `supabase/migrations/20260421001000_indexes.sql`

- [ ] **Step 1: Create migration**

```sql
-- supabase/migrations/20260421001000_indexes.sql
CREATE INDEX idx_devices_tenant ON devices(tenant_id);
CREATE INDEX idx_devices_last_seen ON devices(last_seen_at);
CREATE INDEX idx_media_tenant ON media(tenant_id);
CREATE INDEX idx_playlists_tenant ON playlists(tenant_id);
CREATE INDEX idx_playlist_items_playlist_pos ON playlist_items(playlist_id, position);

CREATE INDEX idx_rules_device_eff
  ON dayparting_rules(target_device_id, effective_at DESC)
  WHERE target_device_id IS NOT NULL;

CREATE INDEX idx_rules_group_eff
  ON dayparting_rules(target_device_group_id, effective_at DESC)
  WHERE target_device_group_id IS NOT NULL;

CREATE INDEX idx_device_group_members_device ON device_group_members(device_id);
CREATE INDEX idx_pairing_expires ON pairing_requests(expires_at);

-- Partial unique index so only ONE unclaimed code of a given value can exist:
CREATE UNIQUE INDEX idx_pairing_unclaimed_code
  ON pairing_requests(code)
  WHERE claimed_at IS NULL;
```

- [ ] **Step 2: Apply and verify**

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\di" | grep idx_
```
Expected: all nine indexes listed.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421001000_indexes.sql
git commit -m "feat(db): add query-supporting indexes"
```

---

## Task 12: Enable RLS + human-access policies

**Files:**
- Create: `supabase/migrations/20260421001100_rls_enable.sql`
- Create: `supabase/migrations/20260421001200_rls_policies.sql`

- [ ] **Step 1: Enable RLS on every tenant-scoped table**

```sql
-- supabase/migrations/20260421001100_rls_enable.sql
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE media ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE dayparting_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_requests ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Write human-access policies**

```sql
-- supabase/migrations/20260421001200_rls_policies.sql

-- Helper: returns tenant_ids the current auth user belongs to.
-- SECURITY DEFINER so it can read tenant_members even when the caller can't.
CREATE OR REPLACE FUNCTION auth_user_tenant_ids() RETURNS SETOF uuid
  LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION auth_user_tenant_ids() FROM public;
GRANT EXECUTE ON FUNCTION auth_user_tenant_ids() TO authenticated, anon;

-- tenants: member can read their tenant
CREATE POLICY tenants_member_read ON tenants FOR SELECT
  USING (id IN (SELECT auth_user_tenant_ids()));

-- tenant_members: member can read rows in their tenant
CREATE POLICY tenant_members_read ON tenant_members FOR SELECT
  USING (tenant_id IN (SELECT auth_user_tenant_ids()));

-- All other tenant-scoped tables: read+write for tenant members
-- (v1 has single owner; finer-grained roles deferred)
CREATE POLICY stores_member_all ON stores FOR ALL
  USING (tenant_id IN (SELECT auth_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT auth_user_tenant_ids()));

CREATE POLICY devices_member_all ON devices FOR ALL
  USING (tenant_id IN (SELECT auth_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT auth_user_tenant_ids()));

CREATE POLICY device_groups_member_all ON device_groups FOR ALL
  USING (tenant_id IN (SELECT auth_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT auth_user_tenant_ids()));

CREATE POLICY device_group_members_member_all ON device_group_members FOR ALL
  USING (
    EXISTS (SELECT 1 FROM device_groups g
            WHERE g.id = device_group_members.device_group_id
              AND g.tenant_id IN (SELECT auth_user_tenant_ids()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM device_groups g
            WHERE g.id = device_group_members.device_group_id
              AND g.tenant_id IN (SELECT auth_user_tenant_ids()))
  );

CREATE POLICY media_member_all ON media FOR ALL
  USING (tenant_id IN (SELECT auth_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT auth_user_tenant_ids()));

CREATE POLICY playlists_member_all ON playlists FOR ALL
  USING (tenant_id IN (SELECT auth_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT auth_user_tenant_ids()));

CREATE POLICY playlist_items_member_all ON playlist_items FOR ALL
  USING (
    EXISTS (SELECT 1 FROM playlists p
            WHERE p.id = playlist_items.playlist_id
              AND p.tenant_id IN (SELECT auth_user_tenant_ids()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM playlists p
            WHERE p.id = playlist_items.playlist_id
              AND p.tenant_id IN (SELECT auth_user_tenant_ids()))
  );

CREATE POLICY dayparting_rules_member_all ON dayparting_rules FOR ALL
  USING (tenant_id IN (SELECT auth_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT auth_user_tenant_ids()));

-- pairing_requests: no direct end-user reads/writes (Edge Functions use service role).
-- An empty policy set + RLS on means nothing is readable via anon/authenticated role.
-- This is intentional.
```

- [ ] **Step 3: Apply and verify**

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\d+ stores" | grep -i "row security"
```
Expected: `Row security: enabled`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260421001100_rls_enable.sql supabase/migrations/20260421001200_rls_policies.sql
git commit -m "feat(db): enable RLS and human-access policies on all tenant tables"
```

**Membership-write policy decision (v1):** `tenant_members` has a SELECT-only policy. Owners cannot invite or remove teammates via PostgREST — v1 is single-tenant UX, so membership writes happen via a service-role seed script, not end-user flows. When Plan 2 (dashboard) adds invites, this decision needs to be revisited (likely via an Edge Function `/members` endpoint, not by relaxing RLS).

---

## Task 12b: Harden SECURITY DEFINER helper + add supporting index

**Why this exists:** Code-review follow-up to Task 12. The original `auth_user_tenant_ids()` function relied on the caller's `search_path`, which is the canonical CVE-class footgun for `SECURITY DEFINER` functions. Standard Supabase hardening pins `search_path` on the function itself. Additionally, `tenant_members`'s PK `(tenant_id, user_id)` doesn't index lookups by `user_id` alone — the helper scans. At v1 scale this is noise, but an index is 2 lines and future-proofs every RLS check.

**Files:**
- Create: `supabase/migrations/20260421001300_rls_function_hardening.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/20260421001300_rls_function_hardening.sql

-- Re-create auth_user_tenant_ids() with pinned search_path and schema-qualified table.
-- Hardens against search_path hijack attacks on SECURITY DEFINER functions.
CREATE OR REPLACE FUNCTION auth_user_tenant_ids() RETURNS SETOF uuid
  LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public, pg_catalog
  AS $$ SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid(); $$;

-- Grants don't survive CREATE OR REPLACE in all Postgres versions; re-apply for safety.
REVOKE ALL ON FUNCTION auth_user_tenant_ids() FROM public;
GRANT EXECUTE ON FUNCTION auth_user_tenant_ids() TO authenticated, anon;

-- tenant_members PK is (tenant_id, user_id); lookups by user_id alone need their own index.
-- Every RLS check on every tenant-scoped table hits this path.
CREATE INDEX IF NOT EXISTS idx_tenant_members_user_id ON tenant_members(user_id);
```

- [ ] **Step 2: Apply and verify**

```bash
supabase db reset
docker exec supabase_db_smart-tv-video-viewer psql -U postgres -c "SELECT proname, proconfig FROM pg_proc WHERE proname = 'auth_user_tenant_ids';"
docker exec supabase_db_smart-tv-video-viewer psql -U postgres -c "\d tenant_members"
```
Expected: `proconfig` contains `search_path=public, pg_catalog`; `\d tenant_members` shows `idx_tenant_members_user_id` on `(user_id)`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421001300_rls_function_hardening.sql docs/superpowers/plans/2026-04-21-plan-1-backend-foundation.md
git commit -m "feat(db): harden auth_user_tenant_ids search_path + index tenant_members(user_id)"
```

---

## Task 13: pgtap smoke test — schema shape

**Files:**
- Create: `supabase/tests/schema.test.sql`

- [ ] **Step 1: Write smoke test**

```sql
-- supabase/tests/schema.test.sql
BEGIN;
SELECT plan(14);

SELECT has_table('tenants');
SELECT has_table('tenant_members');
SELECT has_table('stores');
SELECT has_table('devices');
SELECT has_table('device_groups');
SELECT has_table('device_group_members');
SELECT has_table('media');
SELECT has_table('playlists');
SELECT has_table('playlist_items');
SELECT has_table('dayparting_rules');
SELECT has_table('pairing_requests');

-- Spot-check a few columns we really don't want to drift:
SELECT has_column('devices', 'refresh_token_hash');
SELECT has_column('devices', 'cache_storage_info');
SELECT has_column('stores', 'sync_window_start');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test**

```bash
supabase test db
```
Expected: `14/14 passed`.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/schema.test.sql
git commit -m "test(db): pgtap smoke test for schema shape"
```

---

## Task 14: pgtap test — constraint behavior

**Files:**
- Create: `supabase/tests/constraints.test.sql`

- [ ] **Step 1: Write test asserting CHECKs fire**

```sql
-- supabase/tests/constraints.test.sql
BEGIN;
SELECT plan(4);

-- dayparting_rules XOR on targets
INSERT INTO tenants (id, name) VALUES ('11111111-1111-1111-1111-111111111111', 't');
INSERT INTO stores (id, tenant_id, name) VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 's');
INSERT INTO devices (id, tenant_id, store_id, name) VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'd');
INSERT INTO playlists (id, tenant_id, name) VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'pl');
INSERT INTO device_groups (id, tenant_id, name) VALUES ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'g');

-- Reject: no target
SELECT throws_ok(
  $$ INSERT INTO dayparting_rules (tenant_id, playlist_id, days_of_week, start_time, end_time)
     VALUES ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', ARRAY[1], '00:00', '01:00') $$,
  '23514',
  NULL,
  'rule with zero targets is rejected'
);

-- Reject: both targets
SELECT throws_ok(
  $$ INSERT INTO dayparting_rules (tenant_id, playlist_id, target_device_id, target_device_group_id, days_of_week, start_time, end_time)
     VALUES ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555', ARRAY[1], '00:00', '01:00') $$,
  '23514',
  NULL,
  'rule with both targets is rejected'
);

-- media: video requires duration
SELECT throws_ok(
  $$ INSERT INTO media (tenant_id, kind, r2_path, size_bytes, checksum) VALUES ('11111111-1111-1111-1111-111111111111', 'video', 'x', 1, 'x') $$,
  '23514',
  NULL,
  'video media without duration is rejected'
);

-- media: image must not have duration
SELECT throws_ok(
  $$ INSERT INTO media (tenant_id, kind, r2_path, size_bytes, checksum, video_duration_seconds) VALUES ('11111111-1111-1111-1111-111111111111', 'image', 'x', 1, 'x', 5) $$,
  '23514',
  NULL,
  'image with duration is rejected'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test**

```bash
supabase test db
```
Expected: `4/4 passed` for this test (cumulative count grows).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/constraints.test.sql
git commit -m "test(db): pgtap coverage for critical CHECK constraints"
```

---

## Task 15: pgtap test — RLS cross-tenant isolation (the critical one)

**Files:**
- Create: `supabase/tests/rls_isolation.test.sql`

- [ ] **Step 1: Write the most important test in the project**

```sql
-- supabase/tests/rls_isolation.test.sql
-- If this test ever fails, STOP everything and fix it before shipping.
BEGIN;
SELECT plan(12);

-- Setup: two tenants, two users, one member each.
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@test', '{}', '{}', 'authenticated', 'authenticated'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@test', '{}', '{}', 'authenticated', 'authenticated');

INSERT INTO tenants (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Tenant A'),
  ('22222222-2222-2222-2222-222222222222', 'Tenant B');

INSERT INTO tenant_members (tenant_id, user_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

INSERT INTO stores (id, tenant_id, name) VALUES
  ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'A Store'),
  ('bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'B Store');

INSERT INTO playlists (id, tenant_id, name) VALUES
  ('aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'A PL'),
  ('bbbb4444-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'B PL');

-- Simulate user A's session:
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

SELECT is( (SELECT count(*) FROM tenants), 1::bigint, 'user A sees only own tenant');
SELECT is( (SELECT count(*) FROM tenants WHERE id='22222222-2222-2222-2222-222222222222'), 0::bigint, 'user A cannot see tenant B');
SELECT is( (SELECT count(*) FROM stores), 1::bigint, 'user A sees only own stores');
SELECT is( (SELECT count(*) FROM playlists), 1::bigint, 'user A sees only own playlists');

-- Attempt writes into tenant B:
SELECT throws_ok(
  $$ INSERT INTO stores (tenant_id, name) VALUES ('22222222-2222-2222-2222-222222222222', 'hack') $$,
  '42501',
  NULL,
  'user A cannot insert into tenant B stores'
);

-- RLS filters non-visible rows out of the UPDATE target set BEFORE WITH CHECK
-- runs, so the statement succeeds as a no-op rather than throwing. Use lives_ok.
SELECT lives_ok(
  $$ UPDATE playlists SET name = 'hacked' WHERE tenant_id = '22222222-2222-2222-2222-222222222222' $$,
  'user A UPDATE against tenant B is filtered to a no-op (not an error)'
);
-- Verify the row is untouched and unreadable from user A:
SELECT is( (SELECT name FROM playlists WHERE id='bbbb4444-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), NULL,
           'user A cannot even SELECT tenant B playlist to see it');

-- Switch to user B:
SET LOCAL "request.jwt.claims" TO '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';

SELECT is( (SELECT count(*) FROM tenants), 1::bigint, 'user B sees only own tenant');
SELECT is( (SELECT name FROM stores), 'B Store', 'user B sees B Store');
SELECT is( (SELECT name FROM playlists), 'B PL', 'user B sees B PL');
SELECT is( (SELECT count(*) FROM stores WHERE tenant_id='11111111-1111-1111-1111-111111111111'), 0::bigint,
           'user B cannot see tenant A stores');

-- Anon role: should see nothing at all.
SET LOCAL role TO anon;
SET LOCAL "request.jwt.claims" TO '{}';
SELECT is( (SELECT count(*) FROM tenants), 0::bigint, 'anon sees no tenants');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test**

```bash
supabase test db
```
Expected: all new assertions pass.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/rls_isolation.test.sql
git commit -m "test(db): CRITICAL cross-tenant RLS isolation coverage"
```

---

## Task 16: Shared Edge Function module — JWT utilities

**Files:**
- Create: `supabase/functions/_shared/jwt.ts`
- Create: `supabase/functions/tests/jwt.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// supabase/functions/tests/jwt.test.ts
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mintDeviceAccessToken, verifyDeviceAccessToken } from "../_shared/jwt.ts";

const SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

Deno.test("mint then verify round-trips device access token", async () => {
  const token = await mintDeviceAccessToken({
    deviceId: "11111111-1111-1111-1111-111111111111",
    tenantId: "22222222-2222-2222-2222-222222222222",
    ttlSeconds: 60,
    secret: SECRET,
  });
  const claims = await verifyDeviceAccessToken(token, SECRET);
  assertEquals(claims.sub, "11111111-1111-1111-1111-111111111111");
  assertEquals(claims.tenant_id, "22222222-2222-2222-2222-222222222222");
  assertEquals(claims.role, "device");
});

Deno.test("verify rejects tampered token", async () => {
  const token = await mintDeviceAccessToken({
    deviceId: "11111111-1111-1111-1111-111111111111",
    tenantId: "22222222-2222-2222-2222-222222222222",
    ttlSeconds: 60,
    secret: SECRET,
  });
  const tampered = token.slice(0, -4) + "AAAA";
  await assertRejects(() => verifyDeviceAccessToken(tampered, SECRET));
});

Deno.test("verify rejects expired token", async () => {
  const token = await mintDeviceAccessToken({
    deviceId: "11111111-1111-1111-1111-111111111111",
    tenantId: "22222222-2222-2222-2222-222222222222",
    ttlSeconds: -1, // already expired
    secret: SECRET,
  });
  await assertRejects(() => verifyDeviceAccessToken(token, SECRET));
});
```

- [ ] **Step 2: Run the test to see it fail**

```bash
deno test --allow-net supabase/functions/tests/jwt.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the module**

```ts
// supabase/functions/_shared/jwt.ts
import { create, verify, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

export type DeviceClaims = {
  sub: string;          // device_id
  tenant_id: string;
  role: "device";
  iat: number;
  exp: number;
};

async function importKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function mintDeviceAccessToken(params: {
  deviceId: string;
  tenantId: string;
  ttlSeconds: number;
  secret: string;
}): Promise<string> {
  const key = await importKey(params.secret);
  const now = Math.floor(Date.now() / 1000);
  const payload: DeviceClaims = {
    sub: params.deviceId,
    tenant_id: params.tenantId,
    role: "device",
    iat: now,
    exp: now + params.ttlSeconds,
  };
  return await create({ alg: "HS256", typ: "JWT" }, payload, key);
}

export async function verifyDeviceAccessToken(
  token: string,
  secret: string,
): Promise<DeviceClaims> {
  const key = await importKey(secret);
  const payload = await verify(token, key) as DeviceClaims;
  if (payload.role !== "device") throw new Error("not a device token");
  return payload;
}

/** Generate a 64-char hex opaque refresh token. Stored server-side as SHA-256 hex. */
export function generateRefreshToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function hashRefreshToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 4: Run the test to see it pass**

```bash
deno test --allow-net supabase/functions/tests/jwt.test.ts
```
Expected: `ok | 3 passed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/jwt.ts supabase/functions/tests/jwt.test.ts
git commit -m "feat(fn): shared device JWT mint/verify and refresh-token helpers"
```

---

## Task 17: Shared Edge Function module — R2 presigned URL

**Files:**
- Create: `supabase/functions/_shared/r2.ts`
- Create: `supabase/functions/tests/r2.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// supabase/functions/tests/r2.test.ts
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { presignR2GetUrl, presignR2PutUrl } from "../_shared/r2.ts";

Deno.test("presignR2GetUrl returns URL with expected host and query params", async () => {
  const url = await presignR2GetUrl({
    accountId: "acct",
    accessKeyId: "AKIA_FAKE",
    secretAccessKey: "SECRET_FAKE",
    bucket: "signage-media",
    key: "tenants/abc/media/xyz.mp4",
    ttlSeconds: 3600,
  });
  assertStringIncludes(url, "signage-media");
  assertStringIncludes(url, "X-Amz-Expires=3600");
  assertStringIncludes(url, "tenants/abc/media/xyz.mp4");
});

Deno.test("presignR2PutUrl produces a PUT-signed URL", async () => {
  const url = await presignR2PutUrl({
    accountId: "acct",
    accessKeyId: "AKIA_FAKE",
    secretAccessKey: "SECRET_FAKE",
    bucket: "signage-media",
    key: "tenants/abc/media/new.mp4",
    ttlSeconds: 900,
    contentType: "video/mp4",
  });
  assertStringIncludes(url, "X-Amz-Expires=900");
  assertStringIncludes(url, "X-Amz-Algorithm=AWS4-HMAC-SHA256");
});
```

- [ ] **Step 2: Run the test to see it fail**

```bash
deno test --allow-net supabase/functions/tests/r2.test.ts
```
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the module**

```ts
// supabase/functions/_shared/r2.ts
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

function endpoint(cfg: R2Config): string {
  return `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}`;
}

export async function presignR2GetUrl(params: R2Config & { key: string; ttlSeconds: number }): Promise<string> {
  const client = new AwsClient({
    accessKeyId: params.accessKeyId,
    secretAccessKey: params.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const url = new URL(`${endpoint(params)}/${params.key}`);
  url.searchParams.set("X-Amz-Expires", String(params.ttlSeconds));
  const signed = await client.sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true },
  });
  return signed.url;
}

export async function presignR2PutUrl(params: R2Config & {
  key: string; ttlSeconds: number; contentType: string;
}): Promise<string> {
  const client = new AwsClient({
    accessKeyId: params.accessKeyId,
    secretAccessKey: params.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const url = new URL(`${endpoint(params)}/${params.key}`);
  url.searchParams.set("X-Amz-Expires", String(params.ttlSeconds));
  const signed = await client.sign(url.toString(), {
    method: "PUT",
    headers: { "Content-Type": params.contentType },
    aws: { signQuery: true },
  });
  return signed.url;
}

export function r2ConfigFromEnv(): R2Config {
  return {
    accountId: Deno.env.get("R2_ACCOUNT_ID") ?? "",
    accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID") ?? "",
    secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "",
    bucket: Deno.env.get("R2_BUCKET") ?? "",
  };
}
```

- [ ] **Step 4: Run the test**

```bash
deno test --allow-net supabase/functions/tests/r2.test.ts
```
Expected: `ok | 2 passed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/r2.ts supabase/functions/tests/r2.test.ts
git commit -m "feat(fn): shared R2 presigned URL helper"
```

---

## Task 18: Shared Edge Function module — service-role Supabase client + device auth extractor

**Files:**
- Create: `supabase/functions/_shared/supabase.ts`
- Create: `supabase/functions/_shared/auth.ts`
- Create: `supabase/functions/tests/auth.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// supabase/functions/tests/auth.test.ts
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractDeviceFromRequest } from "../_shared/auth.ts";
import { mintDeviceAccessToken } from "../_shared/jwt.ts";

const SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

Deno.test("extractDeviceFromRequest pulls claims from Bearer header", async () => {
  const token = await mintDeviceAccessToken({
    deviceId: "d1", tenantId: "t1", ttlSeconds: 60, secret: SECRET,
  });
  const req = new Request("http://localhost/", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const claims = await extractDeviceFromRequest(req, SECRET);
  assertEquals(claims.sub, "d1");
  assertEquals(claims.tenant_id, "t1");
});

Deno.test("extractDeviceFromRequest rejects missing header", async () => {
  const req = new Request("http://localhost/");
  await assertRejects(() => extractDeviceFromRequest(req, SECRET));
});
```

- [ ] **Step 2: Run test to see it fail**

```bash
deno test --allow-net supabase/functions/tests/auth.test.ts
```

- [ ] **Step 3: Implement the modules**

```ts
// supabase/functions/_shared/supabase.ts
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export function serviceRoleClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
}
```

```ts
// supabase/functions/_shared/auth.ts
import { verifyDeviceAccessToken, DeviceClaims } from "./jwt.ts";

export async function extractDeviceFromRequest(
  req: Request,
  secret: string,
): Promise<DeviceClaims> {
  const h = req.headers.get("Authorization");
  if (!h || !h.startsWith("Bearer ")) throw new Error("missing bearer");
  const token = h.slice(7);
  return await verifyDeviceAccessToken(token, secret);
}
```

- [ ] **Step 4: Run the test**

```bash
deno test --allow-net supabase/functions/tests/auth.test.ts
```
Expected: `ok | 2 passed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/supabase.ts supabase/functions/_shared/auth.ts supabase/functions/tests/auth.test.ts
git commit -m "feat(fn): service-role client and device auth extractor"
```

---

## Task 19: Edge Function — `pairing-request`

Issues a new pairing code. Called by the TV before it has any credentials.

**Files:**
- Create: `supabase/functions/pairing-request/index.ts`
- Create: `supabase/functions/tests/pairing_request.test.ts`

- [ ] **Step 1: Write integration test**

```ts
// supabase/functions/tests/pairing_request.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FN_URL = Deno.env.get("FN_URL") ?? "http://127.0.0.1:54321/functions/v1/pairing-request";

Deno.test("POST pairing-request returns a 6-char code", async () => {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_proposed_name: "Test TV" }),
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(/^[A-HJ-NP-Z2-9]{6}$/.test(body.code), `code format: got ${body.code}`);
  assert(body.expires_at, "expires_at present");
});
```

- [ ] **Step 2: Scaffold function**

```bash
supabase functions new pairing-request
```

- [ ] **Step 3: Implement**

```ts
// supabase/functions/pairing-request/index.ts
import { serviceRoleClient } from "../_shared/supabase.ts";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

function generateCode(len = 6): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.device_proposed_name === "string"
    ? body.device_proposed_name.slice(0, 80) : null;

  const sb = serviceRoleClient();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // Retry until we get a unique code on the unclaimed unique index:
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    const { error } = await sb.from("pairing_requests").insert({
      code,
      device_proposed_name: name,
      expires_at: expiresAt,
      created_from_ip: req.headers.get("x-forwarded-for") ?? null,
    });
    if (!error) {
      return Response.json({ code, expires_at: expiresAt });
    }
    if (!String(error.message).includes("duplicate")) {
      return new Response("db error: " + error.message, { status: 500 });
    }
  }
  return new Response("could not allocate code", { status: 503 });
});
```

- [ ] **Step 4: Serve locally and run test**

In one terminal:
```bash
supabase functions serve pairing-request --env-file .env.local
```
In another:
```bash
deno test --allow-net --allow-env supabase/functions/tests/pairing_request.test.ts
```
Expected: `ok | 1 passed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/pairing-request supabase/functions/tests/pairing_request.test.ts
git commit -m "feat(fn): pairing-request endpoint"
```

---

## Task 20: Edge Function — `pairing-claim`

Called by the dashboard (as an authenticated human user). Binds the pairing code to a store, creates a device, and issues the refresh+access tokens.

**Files:**
- Create: `supabase/functions/pairing-claim/index.ts`
- Create: `supabase/functions/tests/pairing_claim.test.ts`

- [ ] **Step 1: Write integration test**

```ts
// supabase/functions/tests/pairing_claim.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FN_URL = `${SUPABASE_URL}/functions/v1`;

async function seedUserAndTenant() {
  const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false }});
  const email = `u${Date.now()}@test.local`;
  const { data: user, error: ue } = await svc.auth.admin.createUser({ email, email_confirm: true, password: "Password123!" });
  if (ue) throw ue;
  const { data: tenant } = await svc.from("tenants").insert({ name: "T" }).select().single();
  await svc.from("tenant_members").insert({ tenant_id: tenant!.id, user_id: user.user!.id });
  const { data: store } = await svc.from("stores").insert({ tenant_id: tenant!.id, name: "S" }).select().single();
  // Sign in to get a JWT:
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false }});
  const { data: sess } = await anon.auth.signInWithPassword({ email, password: "Password123!" });
  return { userJwt: sess.session!.access_token, tenantId: tenant!.id, storeId: store!.id };
}

Deno.test("pairing-claim creates device and returns tokens", async () => {
  const { userJwt, storeId } = await seedUserAndTenant();

  const r1 = await fetch(`${FN_URL}/pairing-request`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({ device_proposed_name: "TV 1" }),
  });
  const { code } = await r1.json();

  const r2 = await fetch(`${FN_URL}/pairing-claim`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${userJwt}`,
    },
    body: JSON.stringify({ code, store_id: storeId, name: "TV 1" }),
  });
  assertEquals(r2.status, 200);
  const body = await r2.json();
  assert(body.device_id);
  assert(body.access_token);
  assert(body.refresh_token);
  assert(body.expires_in > 0);
});
```

- [ ] **Step 2: Scaffold**

```bash
supabase functions new pairing-claim
```

- [ ] **Step 3: Implement**

```ts
// supabase/functions/pairing-claim/index.ts
import { serviceRoleClient } from "../_shared/supabase.ts";
import { mintDeviceAccessToken, generateRefreshToken, hashRefreshToken } from "../_shared/jwt.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  // Require Supabase auth header (user JWT)
  const userJwt = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!userJwt) return new Response("unauthenticated", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { code, store_id, name } = body;
  if (!code || !store_id || !name) return new Response("bad request", { status: 400 });

  // Use a user-scoped client so RLS enforces "this user actually owns the store":
  const userClient = (await import("https://esm.sh/@supabase/supabase-js@2.45.0"))
    .createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${userJwt}` } }, auth: { persistSession: false } },
    );

  // RLS-checked fetch of the store (proves the user has access to it):
  const { data: store, error: storeErr } = await userClient
    .from("stores").select("id, tenant_id").eq("id", store_id).single();
  if (storeErr || !store) return new Response("forbidden", { status: 403 });

  // Now use service role for pairing bookkeeping (the pairing row is not accessible by RLS):
  const svc = serviceRoleClient();

  const { data: pr, error: prErr } = await svc
    .from("pairing_requests")
    .select("code, expires_at, claimed_at")
    .eq("code", code)
    .maybeSingle();
  if (prErr) return new Response("db: " + prErr.message, { status: 500 });
  if (!pr) return new Response("code not found", { status: 404 });
  if (pr.claimed_at) return new Response("already claimed", { status: 409 });
  if (new Date(pr.expires_at) < new Date()) return new Response("expired", { status: 410 });

  // Create device:
  const refresh = generateRefreshToken();
  const refreshHash = await hashRefreshToken(refresh);
  const now = new Date().toISOString();

  const { data: device, error: devErr } = await svc.from("devices").insert({
    tenant_id: store.tenant_id,
    store_id: store.id,
    name: String(name).slice(0, 80),
    pairing_code: code,
    paired_at: now,
    refresh_token_hash: refreshHash,
    refresh_token_issued_at: now,
  }).select("id").single();
  if (devErr) return new Response("db: " + devErr.message, { status: 500 });

  await svc.from("pairing_requests").update({
    claimed_at: now,
    claimed_device_id: device.id,
  }).eq("code", code);

  const ttl = 3600;
  const accessToken = await mintDeviceAccessToken({
    deviceId: device.id,
    tenantId: store.tenant_id,
    ttlSeconds: ttl,
    secret: Deno.env.get("SUPABASE_JWT_SECRET")!,
  });

  return Response.json({
    device_id: device.id,
    access_token: accessToken,
    refresh_token: refresh,
    expires_in: ttl,
  });
});
```

- [ ] **Step 4: Serve + run test**

```bash
supabase functions serve --env-file .env.local
# in another terminal:
deno test --allow-net --allow-env supabase/functions/tests/pairing_claim.test.ts
```
Expected: `ok | 1 passed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/pairing-claim supabase/functions/tests/pairing_claim.test.ts
git commit -m "feat(fn): pairing-claim — binds code to store and issues device tokens"
```

---

## Task 21: Edge Function — `pairing-status`

TV polls this while showing the code. Returns `pending` until the dashboard claims it, then `paired` with the device's tokens.

**Files:**
- Create: `supabase/functions/pairing-status/index.ts`
- Create: `supabase/functions/tests/pairing_status.test.ts`

- [ ] **Step 1: Write test**

```ts
// supabase/functions/tests/pairing_status.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FN_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/pairing-status`;

Deno.test("pending code returns pending status", async () => {
  const rNew = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/pairing-request`, {
    method: "POST", headers: {"content-type":"application/json"}, body: "{}",
  });
  const { code } = await rNew.json();

  const res = await fetch(`${FN_URL}?code=${code}`);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "pending");
});

Deno.test("unknown code returns 404", async () => {
  const res = await fetch(`${FN_URL}?code=XXXXXX`);
  assertEquals(res.status, 404);
});
```

- [ ] **Step 2: Scaffold**

```bash
supabase functions new pairing-status
```

- [ ] **Step 3: Implement**

```ts
// supabase/functions/pairing-status/index.ts
// Note: pairing-status is stateful-read only; since claim returns tokens directly
// to dashboard, the TV gets tokens by polling /pairing-status with its own
// proof-of-pairing — the initial pairing row contains the tokens (hashed) only.
// For v1 simplicity: the TV polls with the `code`; if claimed, we return the
// device_id + a one-time-use pickup token (stored ephemerally in pairing_requests.metadata).
// We implement this by having pairing-claim stash the RAW refresh + access tokens
// temporarily in a "tv_pickup" JSONB column on the pairing_requests row, which
// pairing-status drains on first read.

import { serviceRoleClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response("method", { status: 405 });
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return new Response("missing code", { status: 400 });

  const svc = serviceRoleClient();
  const { data, error } = await svc
    .from("pairing_requests")
    .select("code, expires_at, claimed_at, claimed_device_id, tv_pickup")
    .eq("code", code).maybeSingle();

  if (error) return new Response("db: " + error.message, { status: 500 });
  if (!data) return new Response("not found", { status: 404 });

  if (!data.claimed_at) {
    if (new Date(data.expires_at) < new Date()) {
      return Response.json({ status: "expired" });
    }
    return Response.json({ status: "pending" });
  }

  // Paired. Drain the pickup bundle (one-time).
  if (data.tv_pickup) {
    await svc.from("pairing_requests").update({ tv_pickup: null }).eq("code", code);
    return Response.json({
      status: "paired",
      device_id: data.claimed_device_id,
      ...data.tv_pickup,
    });
  }
  // Already picked up once; second read gets just the device_id:
  return Response.json({
    status: "paired_pickup_consumed",
    device_id: data.claimed_device_id,
  });
});
```

- [ ] **Step 4: Add `tv_pickup` column and update pairing-claim to populate it**

Migration:
```sql
-- supabase/migrations/20260421001300_pairing_tv_pickup.sql
ALTER TABLE pairing_requests ADD COLUMN tv_pickup jsonb;
```
Apply: `supabase db reset`.

Update `supabase/functions/pairing-claim/index.ts` — **replace the final return block** so that instead of sending tokens to the dashboard, it stashes them for the TV to pick up and returns only metadata to the dashboard:

```ts
  // ... after building accessToken ...
  await svc.from("pairing_requests").update({
    claimed_at: now,
    claimed_device_id: device.id,
    tv_pickup: { access_token: accessToken, refresh_token: refresh, expires_in: ttl },
  }).eq("code", code);

  return Response.json({
    device_id: device.id,
    name: name,
  });
```

Also remove the earlier pairing_requests UPDATE call (now merged).

- [ ] **Step 5: Re-run pairing_claim test and pairing_status test**

```bash
deno test --allow-net --allow-env supabase/functions/tests/pairing_claim.test.ts
deno test --allow-net --allow-env supabase/functions/tests/pairing_status.test.ts
```
Both should pass. Note: `pairing_claim.test.ts` now receives `device_id` only from claim (not tokens). Update the test's assertions:

```ts
// pairing_claim.test.ts — update assertion section:
  assertEquals(r2.status, 200);
  const body = await r2.json();
  assert(body.device_id);
  assert(body.name);
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260421001300_pairing_tv_pickup.sql supabase/functions/pairing-status supabase/functions/pairing-claim supabase/functions/tests/pairing_status.test.ts supabase/functions/tests/pairing_claim.test.ts
git commit -m "feat(fn): pairing-status with one-time TV token pickup"
```

---

## Task 22: Edge Function — `devices-refresh`

Rotates the refresh token and issues a new access JWT. Implements theft detection.

**Files:**
- Create: `supabase/functions/devices-refresh/index.ts`
- Create: `supabase/functions/tests/refresh.test.ts`

- [ ] **Step 1: Create `_helpers.ts` (shared test helper for device pairing)**

This file is used by this test and by all subsequent Edge Function tests. Create it now so later tasks just import it.

```ts
// supabase/functions/tests/_helpers.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const FN = `${SUPABASE_URL}/functions/v1`;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export type PairedDeviceCreds = {
  device_id: string;
  access_token: string;
  refresh_token: string;
  tenant_id: string;
  store_id: string;
  user_jwt: string;
};

export async function pairDevice(): Promise<PairedDeviceCreds> {
  const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false }});
  const email = `u${Date.now()}${Math.random()}@test.local`;
  const { data: user } = await svc.auth.admin.createUser({ email, email_confirm: true, password: "P@ssw0rd123" });
  const { data: tenant } = await svc.from("tenants").insert({ name:"T"}).select().single();
  await svc.from("tenant_members").insert({ tenant_id: tenant!.id, user_id: user.user!.id });
  const { data: store } = await svc.from("stores").insert({ tenant_id: tenant!.id, name:"S"}).select().single();
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false }});
  const { data: sess } = await anon.auth.signInWithPassword({ email, password: "P@ssw0rd123" });
  const r1 = await fetch(`${FN}/pairing-request`, { method:"POST", headers:{"content-type":"application/json"}, body:"{}"});
  const { code } = await r1.json();
  await fetch(`${FN}/pairing-claim`, {
    method: "POST",
    headers: {"content-type":"application/json", Authorization:`Bearer ${sess.session!.access_token}`},
    body: JSON.stringify({ code, store_id: store!.id, name: "TV" }),
  });
  const pickup = await fetch(`${FN}/pairing-status?code=${code}`).then(r => r.json());
  return {
    device_id: pickup.device_id,
    access_token: pickup.access_token,
    refresh_token: pickup.refresh_token,
    tenant_id: tenant!.id,
    store_id: store!.id,
    user_jwt: sess.session!.access_token,
  };
}
```

- [ ] **Step 2: Write the refresh test using the helper**

```ts
// supabase/functions/tests/refresh.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";

const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

Deno.test("refresh rotates tokens", async () => {
  const creds = await pairDevice();
  const r = await fetch(`${FN}/devices-refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: creds.refresh_token }),
  });
  assertEquals(r.status, 200);
  const body = await r.json();
  assert(body.access_token);
  assert(body.refresh_token);
  assert(body.refresh_token !== creds.refresh_token, "refresh token must rotate");
});

Deno.test("old refresh token becomes invalid after rotation", async () => {
  const creds = await pairDevice();
  await fetch(`${FN}/devices-refresh`, {
    method: "POST", headers: {"content-type":"application/json"},
    body: JSON.stringify({ refresh_token: creds.refresh_token }),
  }).then(r => r.json());

  // Re-use the OLD refresh token — should fail (theft detection)
  const second = await fetch(`${FN}/devices-refresh`, {
    method: "POST", headers: {"content-type":"application/json"},
    body: JSON.stringify({ refresh_token: creds.refresh_token }),
  });
  assertEquals(second.status, 401);
});
```

- [ ] **Step 3: Scaffold + implement**

```bash
supabase functions new devices-refresh
```

```ts
// supabase/functions/devices-refresh/index.ts
import { serviceRoleClient } from "../_shared/supabase.ts";
import { mintDeviceAccessToken, generateRefreshToken, hashRefreshToken } from "../_shared/jwt.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const body = await req.json().catch(() => ({}));
  const raw = body.refresh_token;
  if (typeof raw !== "string" || raw.length < 20) {
    return new Response("bad request", { status: 400 });
  }
  const h = await hashRefreshToken(raw);
  const svc = serviceRoleClient();

  const { data: device, error } = await svc.from("devices")
    .select("id, tenant_id, refresh_token_hash, access_token_ttl_seconds, revoked_at")
    .eq("refresh_token_hash", h).maybeSingle();

  if (error) return new Response("db: " + error.message, { status: 500 });
  if (!device) return new Response("invalid refresh", { status: 401 });
  if (device.revoked_at) return new Response("revoked", { status: 401 });

  const newRaw = generateRefreshToken();
  const newHash = await hashRefreshToken(newRaw);
  const now = new Date().toISOString();

  const { error: updErr } = await svc.from("devices").update({
    refresh_token_hash: newHash,
    refresh_token_last_used_at: now,
    refresh_token_issued_at: now,
  }).eq("id", device.id);
  if (updErr) return new Response("db: " + updErr.message, { status: 500 });

  const accessToken = await mintDeviceAccessToken({
    deviceId: device.id,
    tenantId: device.tenant_id,
    ttlSeconds: device.access_token_ttl_seconds,
    secret: Deno.env.get("SUPABASE_JWT_SECRET")!,
  });

  return Response.json({
    access_token: accessToken,
    refresh_token: newRaw,
    expires_in: device.access_token_ttl_seconds,
  });
});
```

- [ ] **Step 4: Serve + run test**

```bash
supabase functions serve --env-file .env.local
deno test --allow-net --allow-env supabase/functions/tests/refresh.test.ts
```
Expected: `ok | 2 passed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/tests/_helpers.ts supabase/functions/devices-refresh supabase/functions/tests/refresh.test.ts
git commit -m "feat(fn): devices-refresh with rotation and theft detection; test helper"
```

---

## Task 23: Edge Function — `devices-config` with ETag

Returns the full device-facing config. Supports `If-None-Match` → 304.

**Files:**
- Create: `supabase/functions/devices-config/index.ts`
- Create: `supabase/functions/tests/config.test.ts`

- [ ] **Step 1: Write test**

```ts
// supabase/functions/tests/config.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";  // created in Task 22

const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

Deno.test("devices-config returns 200 with version header", async () => {
  const creds = await pairDevice();
  const r = await fetch(`${FN}/devices-config`, {
    headers: { Authorization: `Bearer ${creds.access_token}` },
  });
  assertEquals(r.status, 200);
  const etag = r.headers.get("ETag");
  assert(etag?.startsWith("\"sha256:"));
  const body = await r.json();
  assert(body.version);
  assert(body.device.id);
  assertEquals(typeof body.rules, "object"); // array
});

Deno.test("If-None-Match matching current version returns 304", async () => {
  const creds = await pairDevice();
  const r1 = await fetch(`${FN}/devices-config`, {
    headers: { Authorization: `Bearer ${creds.access_token}` },
  });
  const etag = r1.headers.get("ETag")!;
  const r2 = await fetch(`${FN}/devices-config`, {
    headers: { Authorization: `Bearer ${creds.access_token}`, "If-None-Match": etag },
  });
  assertEquals(r2.status, 304);
});
```

- [ ] **Step 2: Scaffold + implement**

```bash
supabase functions new devices-config
```

```ts
// supabase/functions/devices-config/index.ts
import { serviceRoleClient } from "../_shared/supabase.ts";
import { extractDeviceFromRequest } from "../_shared/auth.ts";
import { presignR2GetUrl, r2ConfigFromEnv } from "../_shared/r2.ts";

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response("method", { status: 405 });

  let claims;
  try { claims = await extractDeviceFromRequest(req, Deno.env.get("SUPABASE_JWT_SECRET")!); }
  catch { return new Response("unauthorized", { status: 401 }); }

  const svc = serviceRoleClient();

  // Revocation check
  const { data: dev, error: devErr } = await svc.from("devices")
    .select("id, tenant_id, store_id, fallback_playlist_id, revoked_at, stores(timezone)")
    .eq("id", claims.sub).single();
  if (devErr || !dev) return new Response("device gone", { status: 401 });
  if (dev.revoked_at) return new Response("revoked", { status: 401 });

  // Collect groups this device belongs to:
  const { data: groups } = await svc.from("device_group_members")
    .select("device_group_id").eq("device_id", dev.id);
  const groupIds = (groups ?? []).map(g => g.device_group_id);

  // Rules targeting this device OR any of its groups, currently effective:
  const { data: rules } = await svc.from("dayparting_rules")
    .select("id, playlist_id, target_device_id, target_device_group_id, days_of_week, start_time, end_time, effective_at")
    .or(
      `target_device_id.eq.${dev.id}` +
      (groupIds.length ? `,target_device_group_id.in.(${groupIds.join(",")})` : "")
    )
    .lte("effective_at", new Date().toISOString())
    .order("effective_at", { ascending: false });

  // Collect all referenced playlists:
  const playlistIds = new Set<string>();
  (rules ?? []).forEach(r => playlistIds.add(r.playlist_id));
  if (dev.fallback_playlist_id) playlistIds.add(dev.fallback_playlist_id);

  const { data: playlists } = playlistIds.size ? await svc.from("playlists")
    .select("id, name, updated_at, playlist_items(id, media_id, position, duration_seconds)")
    .in("id", [...playlistIds]) : { data: [] };

  // Collect media referenced:
  const mediaIds = new Set<string>();
  (playlists ?? []).forEach(p => p.playlist_items.forEach(it => mediaIds.add(it.media_id)));

  const { data: mediaRows } = mediaIds.size ? await svc.from("media")
    .select("id, kind, r2_path, size_bytes, checksum, video_duration_seconds")
    .in("id", [...mediaIds]) : { data: [] };

  const r2cfg = r2ConfigFromEnv();
  const mediaWithUrls = await Promise.all((mediaRows ?? []).map(async m => ({
    id: m.id,
    kind: m.kind,
    size_bytes: m.size_bytes,
    checksum: m.checksum,
    video_duration_seconds: m.video_duration_seconds,
    url: await presignR2GetUrl({ ...r2cfg, key: m.r2_path, ttlSeconds: 86400 }),
  })));

  const payload = {
    device: {
      id: dev.id,
      store_id: dev.store_id,
      fallback_playlist_id: dev.fallback_playlist_id,
      timezone: (dev as any).stores.timezone,
    },
    rules: rules ?? [],
    playlists: (playlists ?? []).map(p => ({
      id: p.id,
      name: p.name,
      updated_at: p.updated_at,
      items: p.playlist_items
        .sort((a,b) => a.position - b.position)
        .map(i => ({ media_id: i.media_id, position: i.position, duration_seconds: i.duration_seconds })),
    })),
    media: mediaWithUrls,
  };

  // Version hash excludes URL (which rotates with expiry) — based on content identity:
  const stable = JSON.stringify({
    device: { ...payload.device },
    rules: payload.rules,
    playlists: payload.playlists,
    media: mediaWithUrls.map(m => ({ id: m.id, kind: m.kind, checksum: m.checksum, size_bytes: m.size_bytes })),
  });
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable));
  const version = "sha256:" + Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,"0")).join("");

  const etag = `"${version}"`;
  if (req.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return new Response(JSON.stringify({ version, ...payload }), {
    status: 200,
    headers: { "content-type": "application/json", ETag: etag },
  });
});
```

- [ ] **Step 3: Serve + run test**

```bash
supabase functions serve --env-file .env.local
deno test --allow-net --allow-env supabase/functions/tests/config.test.ts
```
Expected: `ok | 2 passed`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/devices-config supabase/functions/tests/config.test.ts
git commit -m "feat(fn): devices-config endpoint with ETag/304 caching"
```

---

## Task 24: Edge Function — `devices-heartbeat`

**Files:**
- Create: `supabase/functions/devices-heartbeat/index.ts`
- Create: `supabase/functions/tests/heartbeat.test.ts`

- [ ] **Step 1: Write test**

```ts
// supabase/functions/tests/heartbeat.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";

const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

Deno.test("heartbeat updates last_seen_at and cache_storage_info", async () => {
  const creds = await pairDevice();
  const r = await fetch(`${FN}/devices-heartbeat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({
      app_version: "0.1.0",
      uptime_seconds: 100,
      current_playlist_id: null,
      clock_skew_seconds_from_server: 2,
      cache_storage_info: { root: "internal", total_bytes: 1000, free_bytes: 500 },
      errors_since_last_heartbeat: [],
    }),
  });
  assertEquals(r.status, 204);
});
```

- [ ] **Step 2: Implement**

```bash
supabase functions new devices-heartbeat
```

```ts
// supabase/functions/devices-heartbeat/index.ts
import { serviceRoleClient } from "../_shared/supabase.ts";
import { extractDeviceFromRequest } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  let claims;
  try { claims = await extractDeviceFromRequest(req, Deno.env.get("SUPABASE_JWT_SECRET")!); }
  catch { return new Response("unauthorized", { status: 401 }); }

  const body = await req.json().catch(() => ({}));
  const svc = serviceRoleClient();
  const { error } = await svc.from("devices").update({
    last_seen_at: new Date().toISOString(),
    cache_storage_info: body.cache_storage_info ?? null,
  }).eq("id", claims.sub);
  if (error) return new Response("db: " + error.message, { status: 500 });

  // Errors from client would be persisted to a device_events table in a later plan.
  // For v1 backend, we just acknowledge.
  return new Response(null, { status: 204 });
});
```

- [ ] **Step 3: Serve + test + commit**

```bash
supabase functions serve --env-file .env.local
deno test --allow-net --allow-env supabase/functions/tests/heartbeat.test.ts
git add supabase/functions/devices-heartbeat supabase/functions/tests/heartbeat.test.ts
git commit -m "feat(fn): devices-heartbeat endpoint"
```

---

## Task 25: Edge Function — `devices-cache-status`

Device reports per-media cache state (after sync window). Stored as a `cache_events` table (new) for a running log, plus a denormalized summary in `devices.cache_storage_info`.

**Files:**
- Create: `supabase/migrations/20260421001400_cache_events.sql`
- Create: `supabase/functions/devices-cache-status/index.ts`
- Create: `supabase/functions/tests/cache_status.test.ts`

- [ ] **Step 1: Migration for `cache_events`**

```sql
-- supabase/migrations/20260421001400_cache_events.sql
CREATE TABLE cache_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  media_id uuid REFERENCES media(id) ON DELETE SET NULL,
  state text NOT NULL CHECK (state IN ('cached','failed','evicted','preloaded')),
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cache_events_device_time ON cache_events(device_id, created_at DESC);

ALTER TABLE cache_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY cache_events_member_read ON cache_events FOR SELECT
  USING (tenant_id IN (SELECT auth_user_tenant_ids()));
-- Devices write via service role in Edge Function; no direct policy needed.
```

Apply: `supabase db reset`.

- [ ] **Step 2: Test**

```ts
// supabase/functions/tests/cache_status.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

Deno.test("cache-status inserts events and returns 204", async () => {
  const creds = await pairDevice();
  const r = await fetch(`${FN}/devices-cache-status`, {
    method: "POST",
    headers: {"content-type": "application/json", Authorization: `Bearer ${creds.access_token}`},
    body: JSON.stringify({
      events: [
        { media_id: null, state: "cached", message: "initial" },
      ],
    }),
  });
  assertEquals(r.status, 204);

  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data } = await svc.from("cache_events").select("*").eq("device_id", creds.device_id);
  assert((data ?? []).length >= 1);
});
```

- [ ] **Step 3: Implement**

```bash
supabase functions new devices-cache-status
```

```ts
// supabase/functions/devices-cache-status/index.ts
import { serviceRoleClient } from "../_shared/supabase.ts";
import { extractDeviceFromRequest } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  let claims;
  try { claims = await extractDeviceFromRequest(req, Deno.env.get("SUPABASE_JWT_SECRET")!); }
  catch { return new Response("unauthorized", { status: 401 }); }

  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.events)) return new Response("bad body", { status: 400 });

  const svc = serviceRoleClient();
  const rows = body.events.map((e: any) => ({
    tenant_id: claims.tenant_id,
    device_id: claims.sub,
    media_id: e.media_id ?? null,
    state: e.state,
    message: e.message?.slice(0, 500) ?? null,
  }));
  const { error } = await svc.from("cache_events").insert(rows);
  if (error) return new Response("db: " + error.message, { status: 500 });
  return new Response(null, { status: 204 });
});
```

- [ ] **Step 4: Run test + commit**

```bash
supabase functions serve --env-file .env.local
deno test --allow-net --allow-env supabase/functions/tests/cache_status.test.ts
git add supabase/migrations/20260421001400_cache_events.sql supabase/functions/devices-cache-status supabase/functions/tests/cache_status.test.ts
git commit -m "feat(fn): devices-cache-status + cache_events log"
```

---

## Task 26: Shared FCM sender + `devices-sync-now`

**Files:**
- Create: `supabase/functions/_shared/fcm.ts`
- Create: `supabase/functions/devices-sync-now/index.ts`
- Create: `supabase/functions/tests/sync_now.test.ts`

- [ ] **Step 1: FCM module**

```ts
// supabase/functions/_shared/fcm.ts
// Uses Firebase HTTP v1 API. Requires FCM_SERVICE_ACCOUNT_JSON (full JSON as string)
// and FCM_PROJECT_ID env vars.

import { create as jwtCreate, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

type ServiceAccount = {
  private_key: string;
  client_email: string;
  token_uri: string;
};

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const clean = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, "");
  const der = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function getAccessToken(): Promise<string> {
  const saJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!saJson) throw new Error("FCM_SERVICE_ACCOUNT_JSON not set");
  const sa: ServiceAccount = JSON.parse(saJson);

  const key = await importPrivateKey(sa.private_key);
  const jwt = await jwtCreate(
    { alg: "RS256", typ: "JWT" },
    {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: sa.token_uri,
      exp: getNumericDate(3600),
      iat: getNumericDate(0),
    },
    key,
  );
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const res = await fetch(sa.token_uri, { method: "POST", body });
  if (!res.ok) throw new Error("token exchange failed: " + await res.text());
  const j = await res.json();
  return j.access_token as string;
}

export async function sendFcmSync(fcmToken: string): Promise<void> {
  const projectId = Deno.env.get("FCM_PROJECT_ID");
  if (!projectId) throw new Error("FCM_PROJECT_ID not set");
  const at = await getAccessToken();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${at}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        data: { action: "sync" },
        android: { priority: "HIGH" },
      },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`fcm send failed: ${res.status} ${txt}`);
  }
}
```

- [ ] **Step 2: Test (mock FCM in test env)**

```ts
// supabase/functions/tests/sync_now.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";

const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

Deno.test("sync-now accepts request from tenant user", async () => {
  const creds = await pairDevice();
  // Note: without fcm_token set on device, endpoint returns 204 but skips FCM call.
  const r = await fetch(`${FN}/devices-sync-now`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${creds.user_jwt}` },
    body: JSON.stringify({ device_id: creds.device_id }),
  });
  // Server accepts even if no fcm_token (no-op); status 202.
  assertEquals(r.status, 202);
});
```

- [ ] **Step 3: Implement sync-now**

```bash
supabase functions new devices-sync-now
```

```ts
// supabase/functions/devices-sync-now/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendFcmSync } from "../_shared/fcm.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const userJwt = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!userJwt) return new Response("unauthenticated", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const deviceId: string | undefined = body.device_id;
  const groupId: string | undefined = body.device_group_id;
  if (!deviceId && !groupId) return new Response("missing target", { status: 400 });

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${userJwt}` } }, auth: { persistSession: false } },
  );

  let targetIds: string[] = [];
  if (deviceId) {
    const { data } = await userClient.from("devices").select("id,fcm_token").eq("id", deviceId).maybeSingle();
    if (!data) return new Response("forbidden", { status: 403 });
    if (data.fcm_token) targetIds.push(data.fcm_token);
  } else if (groupId) {
    const { data } = await userClient.from("device_group_members")
      .select("device_id, devices!inner(fcm_token)").eq("device_group_id", groupId);
    targetIds = (data ?? [])
      .map((r: any) => r.devices?.fcm_token)
      .filter((t: unknown): t is string => typeof t === "string");
  }

  // Fire-and-forget; log failures but respond fast.
  await Promise.allSettled(targetIds.map(t => sendFcmSync(t)));
  return new Response(null, { status: 202 });
});
```

- [ ] **Step 4: Run test + commit**

```bash
supabase functions serve --env-file .env.local
deno test --allow-net --allow-env supabase/functions/tests/sync_now.test.ts
git add supabase/functions/_shared/fcm.ts supabase/functions/devices-sync-now supabase/functions/tests/sync_now.test.ts
git commit -m "feat(fn): devices-sync-now with FCM HTTP v1 sender"
```

---

## Task 27: End-to-end integration test — full happy path

**Files:**
- Create: `supabase/functions/tests/e2e.test.ts`

- [ ] **Step 1: Write the end-to-end test**

```ts
// supabase/functions/tests/e2e.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.test("E2E: pair → heartbeat → config → refresh → config (new ETag)", async () => {
  const creds = await pairDevice();

  // Heartbeat
  const hb = await fetch(`${FN}/devices-heartbeat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ app_version: "0.1.0", cache_storage_info: { root: "internal" }, errors_since_last_heartbeat: [] }),
  });
  assertEquals(hb.status, 204);

  // Config v1
  const c1 = await fetch(`${FN}/devices-config`, {
    headers: { Authorization: `Bearer ${creds.access_token}` },
  });
  assertEquals(c1.status, 200);
  const etag1 = c1.headers.get("ETag");

  // Seed a fallback playlist for this device; version should change
  const svc = createClient(SUPABASE_URL, SERVICE);
  const { data: pl } = await svc.from("playlists").insert({ tenant_id: creds.tenant_id, name: "fallback" }).select().single();
  await svc.from("devices").update({ fallback_playlist_id: pl!.id }).eq("id", creds.device_id);

  // Config after change: ETag must differ
  const c2 = await fetch(`${FN}/devices-config`, {
    headers: { Authorization: `Bearer ${creds.access_token}`, "If-None-Match": etag1 ?? "" },
  });
  assertEquals(c2.status, 200);
  const etag2 = c2.headers.get("ETag");
  assert(etag1 !== etag2, "ETag must change when fallback playlist changes");

  // Refresh
  const rr = await fetch(`${FN}/devices-refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: creds.refresh_token }),
  });
  assertEquals(rr.status, 200);
  const newCreds = await rr.json();
  assert(newCreds.access_token !== creds.access_token);
});
```

- [ ] **Step 2: Run the full test suite**

```bash
supabase db reset
supabase functions serve --env-file .env.local
deno test --allow-net --allow-env supabase/functions/tests/
supabase test db
```
All Deno tests pass; pgtap cumulative passes.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/tests/e2e.test.ts
git commit -m "test(fn): end-to-end pairing + heartbeat + config + refresh flow"
```

---

## Post-Plan checks

- [ ] **Link local dev to a remote Supabase project:** `supabase link --project-ref <ref>` then `supabase db push` to deploy migrations.
- [ ] **Deploy functions to remote:** `supabase functions deploy --no-verify-jwt` (custom JWT handling, so we disable built-in verification).
- [ ] **Set secrets on remote:**
  ```bash
  supabase secrets set R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=signage-media R2_ENDPOINT=... FCM_SERVICE_ACCOUNT_JSON='...' FCM_PROJECT_ID=...
  ```
- [ ] **Smoke-test remote** — run `deno test` against `SUPABASE_URL=<remote>` to verify.

---

## Exit criteria (Plan 1 is "done" when)

- All 27 tasks checked
- `supabase test db` passes (schema + constraints + RLS isolation)
- `deno test --allow-net --allow-env supabase/functions/tests/` all green
- Remote Supabase project has schema deployed and Edge Functions serving
- The E2E test in Task 27 passes against the remote project

At that point Plan 2 (dashboard) is unblocked and can begin.
