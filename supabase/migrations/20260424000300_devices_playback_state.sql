-- supabase/migrations/20260424000300_devices_playback_state.sql
-- Two columns to mirror the device's current PlaybackDirector state on the
-- dashboard. current_media_id is a free-form text field (not FK to media)
-- because the device may report a media_id that was since deleted; the
-- dashboard tolerates stale references rather than failing the write.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS current_media_id text,
  ADD COLUMN IF NOT EXISTS playback_state text;
