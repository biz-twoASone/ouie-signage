-- supabase/migrations/20260424001100_devices_fcm_dispatch.sql
-- Plan 5 Phase 3 Task 17.
-- FCM dispatch outcome tracking. devices-sync-now stamps these on every send
-- so the dashboard can distinguish:
--   - last_fcm_dispatched_at AND last_fcm_received_at populated → roundtrip OK
--   - dispatched but no receipt within 60s → device socket likely stale
--   - last_fcm_dispatch_error populated → server-side problem (FCM rejected)
--
-- Note: this is single-state, NOT historical. A new dispatch overwrites the
-- previous one. Sufficient for 8 devices; revisit if we need a per-event audit
-- log.
ALTER TABLE devices
    ADD COLUMN last_fcm_dispatched_at timestamptz,
    ADD COLUMN last_fcm_dispatch_message_id text,
    ADD COLUMN last_fcm_dispatch_error text;

COMMENT ON COLUMN devices.last_fcm_dispatched_at IS
    'Timestamp of the most recent devices-sync-now FCM call attempt for this device. Stamped regardless of FCM HTTP outcome.';
COMMENT ON COLUMN devices.last_fcm_dispatch_message_id IS
    'FCM HTTP v1 messages:send response.name field on success (e.g. "projects/X/messages/0:1234"). NULL when dispatch failed.';
COMMENT ON COLUMN devices.last_fcm_dispatch_error IS
    'FCM error string when dispatch failed (HTTP status + body excerpt). NULL when dispatch succeeded.';
