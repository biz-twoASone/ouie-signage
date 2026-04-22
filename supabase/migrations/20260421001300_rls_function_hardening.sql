-- supabase/migrations/20260421001300_rls_function_hardening.sql

-- Re-create auth_user_tenant_ids() with pinned search_path and schema-qualified table.
-- Hardens against search_path hijack attacks on SECURITY DEFINER functions.
CREATE OR REPLACE FUNCTION auth_user_tenant_ids() RETURNS SETOF uuid
  LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public, pg_catalog
  AS $$ SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid(); $$;

-- Grants don't survive CREATE OR REPLACE in all Postgres versions; re-apply for safety.
REVOKE ALL ON FUNCTION auth_user_tenant_ids() FROM public;
GRANT EXECUTE ON FUNCTION auth_user_tenant_ids() TO authenticated, anon;

-- tenant_members PK is (tenant_id, user_id); lookups by user_id alone need their own index.
-- Every RLS check on every tenant-scoped table hits this path.
CREATE INDEX IF NOT EXISTS idx_tenant_members_user_id ON tenant_members(user_id);
