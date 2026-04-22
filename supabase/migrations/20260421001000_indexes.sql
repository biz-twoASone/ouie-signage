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
