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
