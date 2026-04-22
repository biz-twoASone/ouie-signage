alter table public.tenants
  add column alerts_enabled boolean not null default true,
  add column alert_offline_threshold_minutes integer not null default 30
    check (alert_offline_threshold_minutes between 5 and 1440),
  add column alert_recipient_email text;

comment on column public.tenants.alerts_enabled is
  'When false, alerts-device-offline Edge Function skips this tenant entirely.';
comment on column public.tenants.alert_offline_threshold_minutes is
  'Minutes since last heartbeat before a screen is considered offline for alert purposes. 5-1440.';
comment on column public.tenants.alert_recipient_email is
  'Override recipient email. When NULL, falls back to tenant owner auth email.';
