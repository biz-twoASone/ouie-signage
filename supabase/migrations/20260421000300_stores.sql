-- supabase/migrations/20260421000300_stores.sql
CREATE TABLE stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  sync_window_start time NOT NULL DEFAULT '02:00',
  sync_window_end time NOT NULL DEFAULT '05:00',
  created_at timestamptz NOT NULL DEFAULT now()
);
