alter table public.devices
  add column if not exists current_app_version text,
  add column if not exists current_playlist_id uuid references public.playlists(id) on delete set null,
  add column if not exists last_config_version_applied text,
  add column if not exists clock_skew_seconds_from_server int;
