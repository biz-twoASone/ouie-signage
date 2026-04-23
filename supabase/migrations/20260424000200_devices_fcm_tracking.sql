-- supabase/migrations/20260424000200_devices_fcm_tracking.sql
-- Two columns to track FCM push dispatch/receipt so the dashboard can display
-- delivery latency per device. State-only (not history); subsequent dispatches
-- overwrite prior values. For 8 TVs in one location this is sufficient —
-- operator clicks Sync Now, sees the delta on next heartbeat refresh.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS last_fcm_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_now_dispatched_at timestamptz;
