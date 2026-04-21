-- supabase/tests/rls_isolation.test.sql
-- If this test ever fails, STOP everything and fix it before shipping.
BEGIN;
SELECT plan(12);

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

-- Switch to user B:
SET LOCAL "request.jwt.claims" TO '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';

SELECT is( (SELECT count(*) FROM tenants), 1::bigint, 'user B sees only own tenant');
SELECT is( (SELECT name FROM stores), 'B Store', 'user B sees B Store');
SELECT is( (SELECT name FROM playlists), 'B PL', 'user B sees B PL');
SELECT is( (SELECT count(*) FROM stores WHERE tenant_id='11111111-1111-1111-1111-111111111111'), 0::bigint,
           'user B cannot see tenant A stores');

-- Anon role: should see nothing at all.
SET LOCAL role TO anon;
SET LOCAL "request.jwt.claims" TO '{}';
SELECT is( (SELECT count(*) FROM tenants), 0::bigint, 'anon sees no tenants');

SELECT * FROM finish();
ROLLBACK;
