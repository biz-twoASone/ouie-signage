-- supabase/migrations/20260421001500_cache_events.sql
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
