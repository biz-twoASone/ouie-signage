-- pg_cron lives in the cron schema.
create extension if not exists pg_cron with schema extensions;

-- Grant usage so the Edge Function running as service_role can schedule jobs.
-- (Supabase automatically grants cron.schedule to postgres user; service_role
-- bypasses RLS but still needs function-level grants for pg_cron internals.)
grant usage on schema cron to postgres, service_role;
