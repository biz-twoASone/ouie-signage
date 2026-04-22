-- Extend media to support two-phase uploads (pending → uploaded).
-- Also add mime_type so presigned PUT URLs can include Content-Type.

alter table public.media
  add column if not exists mime_type text,
  add column if not exists upload_state text not null default 'uploaded'
    check (upload_state in ('pending','uploaded','failed'));

-- Relax NOT NULL on checksum for pending rows.
alter table public.media alter column checksum drop not null;

-- Drop the original CHECK that required video_duration_seconds NOT NULL for videos,
-- and replace with one that only enforces it once upload_state = 'uploaded'.
-- The existing constraint name is derived from the column list; drop defensively.
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.media'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%video_duration_seconds%'
  loop
    execute format('alter table public.media drop constraint %I', c);
  end loop;
end$$;

alter table public.media add constraint media_kind_duration_check check (
  upload_state <> 'uploaded'
  or (
    (kind = 'image' and video_duration_seconds is null)
    or (kind = 'video' and video_duration_seconds is not null and video_duration_seconds > 0)
  )
);
