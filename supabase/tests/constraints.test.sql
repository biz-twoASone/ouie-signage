-- supabase/tests/constraints.test.sql
BEGIN;
SELECT plan(4);

-- dayparting_rules XOR on targets
INSERT INTO tenants (id, name) VALUES ('11111111-1111-1111-1111-111111111111', 't');
INSERT INTO stores (id, tenant_id, name) VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 's');
INSERT INTO devices (id, tenant_id, store_id, name) VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'd');
INSERT INTO playlists (id, tenant_id, name) VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'pl');
INSERT INTO device_groups (id, tenant_id, name) VALUES ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'g');

-- Reject: no target
SELECT throws_ok(
  $$ INSERT INTO dayparting_rules (tenant_id, playlist_id, days_of_week, start_time, end_time)
     VALUES ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', ARRAY[1], '00:00', '01:00') $$,
  '23514',
  NULL,
  'rule with zero targets is rejected'
);

-- Reject: both targets
SELECT throws_ok(
  $$ INSERT INTO dayparting_rules (tenant_id, playlist_id, target_device_id, target_device_group_id, days_of_week, start_time, end_time)
     VALUES ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555', ARRAY[1], '00:00', '01:00') $$,
  '23514',
  NULL,
  'rule with both targets is rejected'
);

-- media: video requires duration
SELECT throws_ok(
  $$ INSERT INTO media (tenant_id, kind, r2_path, size_bytes, checksum) VALUES ('11111111-1111-1111-1111-111111111111', 'video', 'x', 1, 'x') $$,
  '23514',
  NULL,
  'video media without duration is rejected'
);

-- media: image must not have duration
SELECT throws_ok(
  $$ INSERT INTO media (tenant_id, kind, r2_path, size_bytes, checksum, video_duration_seconds) VALUES ('11111111-1111-1111-1111-111111111111', 'image', 'x', 1, 'x', 5) $$,
  '23514',
  NULL,
  'image with duration is rejected'
);

SELECT * FROM finish();
ROLLBACK;
