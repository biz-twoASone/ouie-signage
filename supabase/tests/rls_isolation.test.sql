-- supabase/tests/rls_isolation.test.sql
-- If this test ever fails, STOP everything and fix it before shipping.
BEGIN;
SELECT plan(16);

-- Setup: two tenants, two users, one member each.
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@test', '{}', '{}', 'authenticated', 'authenticated'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@test', '{}', '{}', 'authenticated', 'authenticated');

INSERT INTO tenants (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Tenant A'),
  ('22222222-2222-2222-2222-222222222222', 'Tenant B');

INSERT INTO tenant_members (tenant_id, user_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

INSERT INTO stores (id, tenant_id, name) VALUES
  ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'A Store'),
  ('bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'B Store');

INSERT INTO playlists (id, tenant_id, name) VALUES
  ('aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'A PL'),
  ('bbbb4444-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'B PL');

-- Seed join-table rows so the EXISTS-subquery policies on playlist_items
-- get exercised (not just direct-tenant_id policies).
INSERT INTO media (id, tenant_id, kind, r2_path, size_bytes, checksum, video_duration_seconds) VALUES
  ('aaaa5555-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'video', 'r2://a/v.mp4', 1, 'aaaa', 10),
  ('bbbb6666-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'video', 'r2://b/v.mp4', 1, 'bbbb', 10);

INSERT INTO playlist_items (id, playlist_id, media_id, position) VALUES
  ('aaaa7777-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaa5555-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0),
  ('bbbb8888-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbb4444-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbb6666-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 0);

-- pairing_requests has no tenant_id (global pre-claim namespace). RLS is on,
-- zero policies — meaning authenticated/anon must read zero rows regardless
-- of existence. Seed one so a regression that adds a permissive policy would
-- fail the lockdown assertion below.
INSERT INTO pairing_requests (code, expires_at) VALUES
  ('TESTCODE1', now() + interval '10 minutes');

-- Simulate user A's session:
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

SELECT is( (SELECT count(*) FROM tenants), 1::bigint, 'user A sees only own tenant');
SELECT is( (SELECT count(*) FROM tenants WHERE id='22222222-2222-2222-2222-222222222222'), 0::bigint, 'user A cannot see tenant B');
SELECT is( (SELECT count(*) FROM stores), 1::bigint, 'user A sees only own stores');
SELECT is( (SELECT count(*) FROM playlists), 1::bigint, 'user A sees only own playlists');

-- Attempt writes into tenant B:
SELECT throws_ok(
  $$ INSERT INTO stores (tenant_id, name) VALUES ('22222222-2222-2222-2222-222222222222', 'hack') $$,
  '42501',
  NULL,
  'user A cannot insert into tenant B stores'
);

-- RLS filters non-visible rows out of the UPDATE target set BEFORE WITH CHECK
-- runs, so the statement succeeds as a no-op rather than throwing. Use lives_ok.
SELECT lives_ok(
  $$ UPDATE playlists SET name = 'hacked' WHERE tenant_id = '22222222-2222-2222-2222-222222222222' $$,
  'user A UPDATE against tenant B is filtered to a no-op (not an error)'
);
-- Verify the row is untouched and unreadable from user A:
SELECT is( (SELECT name FROM playlists WHERE id='bbbb4444-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), NULL,
           'user A cannot even SELECT tenant B playlist to see it');

-- Reparent attack: user A updates THEIR OWN row and tries to set tenant_id to B.
-- USING does not block this (the row is user A's, visible). Only WITH CHECK
-- rejects the new value. This is the single most dangerous cross-tenant path
-- and must always throw 42501.
SELECT throws_ok(
  $$ UPDATE playlists SET tenant_id = '22222222-2222-2222-2222-222222222222'
     WHERE id = 'aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501', NULL,
  'user A cannot reparent own playlist into tenant B (WITH CHECK enforced)'
);

-- EXISTS-based join-table policy on playlist_items: isolates via parent
-- playlist's tenant_id. A regression that simplifies the policy (e.g., drops
-- the subquery) would leak across tenants.
SELECT is( (SELECT count(*) FROM playlist_items), 1::bigint,
           'user A sees only own playlist_items (EXISTS-subquery policy)');

-- pairing_requests is RLS-on with zero policies — service-role-only. Even
-- though a row exists, authenticated must see zero rows.
SELECT is( (SELECT count(*) FROM pairing_requests), 0::bigint,
           'user A cannot read pairing_requests (empty-policy lockdown)');

-- Switch to user B:
SET LOCAL "request.jwt.claims" TO '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';

SELECT is( (SELECT count(*) FROM tenants), 1::bigint, 'user B sees only own tenant');
SELECT is( (SELECT name FROM stores), 'B Store', 'user B sees B Store');
SELECT is( (SELECT name FROM playlists), 'B PL', 'user B sees B PL');
SELECT is( (SELECT count(*) FROM stores WHERE tenant_id='11111111-1111-1111-1111-111111111111'), 0::bigint,
           'user B cannot see tenant A stores');
SELECT is( (SELECT count(*) FROM playlist_items), 1::bigint,
           'user B sees only own playlist_items (EXISTS-subquery policy)');

-- Anon role: should see nothing at all.
SET LOCAL role TO anon;
SET LOCAL "request.jwt.claims" TO '{}';
SELECT is( (SELECT count(*) FROM tenants), 0::bigint, 'anon sees no tenants');

SELECT * FROM finish();
ROLLBACK;
