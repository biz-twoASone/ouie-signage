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
