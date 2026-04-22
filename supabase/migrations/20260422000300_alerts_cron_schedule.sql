-- Schedule the alerts function to run every 5 minutes. pg_cron calls it via
-- HTTP using the service-role key stored as a DB parameter (set by Supabase
-- automatically — supabase_service_role_key is always available).
--
-- NOTE: This DOES NOT run during local `supabase start` because local
-- Supabase bundles pg_cron but doesn't reliably execute its HTTP calls
-- against `http://host.docker.internal:54321`. Expect this to silently no-op
-- locally; it activates only on remote Supabase.

select cron.schedule(
  'alerts-device-offline-every-5min',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/alerts-device-offline',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := '{}'::jsonb
    );
  $$
);
