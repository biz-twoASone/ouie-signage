-- supabase/migrations/20260424000100_device_error_events.sql
-- Persists the per-heartbeat errors_since_last_heartbeat payload so operators
-- can see what a device reported without ADB. Mirrors cache_events for
-- consistency: same column naming, same RLS policy shape, same write path
-- (service-role Edge Function with explicit tenant filter).
CREATE TABLE device_error_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  kind text NOT NULL,                             -- free-form; new kinds added client-side without migrations
  media_id uuid REFERENCES media(id) ON DELETE SET NULL,
  message text,
  occurred_at timestamptz NOT NULL,               -- from device ErrorEvent.timestamp
  created_at timestamptz NOT NULL DEFAULT now()   -- server insert time (forensics if device clock drifts)
);
CREATE INDEX idx_device_error_events_device_time
  ON device_error_events(device_id, occurred_at DESC);

ALTER TABLE device_error_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY device_error_events_member_read ON device_error_events FOR SELECT
  USING (tenant_id IN (SELECT auth_user_tenant_ids()));
-- Devices write via service role in Edge Function; no direct policy needed.
