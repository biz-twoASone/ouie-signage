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
