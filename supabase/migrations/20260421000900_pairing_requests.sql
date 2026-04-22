-- supabase/migrations/20260421000900_pairing_requests.sql
CREATE TABLE pairing_requests (
  code text PRIMARY KEY,
  device_proposed_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  claimed_device_id uuid REFERENCES devices(id) ON DELETE SET NULL,

  -- Rate-limit bucket (simple per-source column; IPs recorded by Edge Function)
  created_from_ip inet
);
