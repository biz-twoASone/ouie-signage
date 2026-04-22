-- Extensions required by later migrations and tests
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgtap";      -- used in supabase/tests/*.test.sql
