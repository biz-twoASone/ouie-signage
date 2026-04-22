-- supabase/tests/schema.test.sql
BEGIN;
SELECT plan(14);

SELECT has_table('tenants');
SELECT has_table('tenant_members');
SELECT has_table('stores');
SELECT has_table('devices');
SELECT has_table('device_groups');
SELECT has_table('device_group_members');
SELECT has_table('media');
SELECT has_table('playlists');
SELECT has_table('playlist_items');
SELECT has_table('dayparting_rules');
SELECT has_table('pairing_requests');

-- Spot-check a few columns we really don't want to drift:
SELECT has_column('devices', 'refresh_token_hash');
SELECT has_column('devices', 'cache_storage_info');
SELECT has_column('stores', 'sync_window_start');

SELECT * FROM finish();
ROLLBACK;
