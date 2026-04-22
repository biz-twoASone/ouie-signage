-- supabase/migrations/20260421001200_rls_policies.sql

-- Helper: returns tenant_ids the current auth user belongs to.
-- SECURITY DEFINER so it can read tenant_members even when the caller can't.
CREATE OR REPLACE FUNCTION auth_user_tenant_ids() RETURNS SETOF uuid
  LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION auth_user_tenant_ids() FROM public;
GRANT EXECUTE ON FUNCTION auth_user_tenant_ids() TO authenticated, anon;

-- tenants: member can read their tenant
CREATE POLICY tenants_member_read ON tenants FOR SELECT
  USING (id IN (SELECT auth_user_tenant_ids()));

-- tenant_members: member can read rows in their tenant
CREATE POLICY tenant_members_read ON tenant_members FOR SELECT
  USING (tenant_id IN (SELECT auth_user_tenant_ids()));

-- All other tenant-scoped tables: read+write for tenant members
-- (v1 has single owner; finer-grained roles deferred)
CREATE POLICY stores_member_all ON stores FOR ALL
  USING (tenant_id IN (SELECT auth_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT auth_user_tenant_ids()));

CREATE POLICY devices_member_all ON devices FOR ALL
  USING (tenant_id IN (SELECT auth_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT auth_user_tenant_ids()));

CREATE POLICY device_groups_member_all ON device_groups FOR ALL
  USING (tenant_id IN (SELECT auth_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT auth_user_tenant_ids()));

CREATE POLICY device_group_members_member_all ON device_group_members FOR ALL
  USING (
    EXISTS (SELECT 1 FROM device_groups g
            WHERE g.id = device_group_members.device_group_id
              AND g.tenant_id IN (SELECT auth_user_tenant_ids()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM device_groups g
            WHERE g.id = device_group_members.device_group_id
              AND g.tenant_id IN (SELECT auth_user_tenant_ids()))
  );

CREATE POLICY media_member_all ON media FOR ALL
  USING (tenant_id IN (SELECT auth_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT auth_user_tenant_ids()));

CREATE POLICY playlists_member_all ON playlists FOR ALL
  USING (tenant_id IN (SELECT auth_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT auth_user_tenant_ids()));

CREATE POLICY playlist_items_member_all ON playlist_items FOR ALL
  USING (
    EXISTS (SELECT 1 FROM playlists p
            WHERE p.id = playlist_items.playlist_id
              AND p.tenant_id IN (SELECT auth_user_tenant_ids()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM playlists p
            WHERE p.id = playlist_items.playlist_id
              AND p.tenant_id IN (SELECT auth_user_tenant_ids()))
  );

CREATE POLICY dayparting_rules_member_all ON dayparting_rules FOR ALL
  USING (tenant_id IN (SELECT auth_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT auth_user_tenant_ids()));

-- pairing_requests: no direct end-user reads/writes (Edge Functions use service role).
-- An empty policy set + RLS on means nothing is readable via anon/authenticated role.
-- This is intentional.
