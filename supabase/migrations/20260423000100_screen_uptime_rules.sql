-- supabase/migrations/20260423000100_screen_uptime_rules.sql
create table public.screen_uptime_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Exactly one of target_device_id / target_device_group_id must be set.
  target_device_id uuid references public.devices(id) on delete cascade,
  target_device_group_id uuid references public.device_groups(id) on delete cascade,
  constraint uptime_single_target check (
    (target_device_id is not null)::int + (target_device_group_id is not null)::int = 1
  ),

  -- ISO day numbering 1=Mon..7=Sun. Mirrors dayparting_rules for consistency.
  days_of_week int[] not null
    check (array_length(days_of_week, 1) between 1 and 7
           and days_of_week <@ array[1,2,3,4,5,6,7]),
  start_time time not null,
  end_time time not null,
  -- Note: end_time <= start_time means the window crosses midnight; valid.
  -- Example: start=22:00, end=02:00 means 10pm today through 2am next day.

  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- Lookup by device (the hot path from alerts-device-offline).
create index screen_uptime_rules_device_idx
  on public.screen_uptime_rules (target_device_id)
  where target_device_id is not null;

-- Lookup by group (secondary path when a device has no device-level rules).
create index screen_uptime_rules_group_idx
  on public.screen_uptime_rules (target_device_group_id)
  where target_device_group_id is not null;

alter table public.screen_uptime_rules enable row level security;

create policy screen_uptime_rules_member_all on public.screen_uptime_rules
  for all
  using (tenant_id in (select auth_user_tenant_ids()))
  with check (tenant_id in (select auth_user_tenant_ids()));

comment on table public.screen_uptime_rules is
  'Per-device or per-group "expected uptime" windows. alerts-device-offline Edge Function suppresses alerts unless the current time-in-store-TZ matches at least one rule. Device-level rules override group-level rules entirely; a device with zero rules is silent by default.';
comment on column public.screen_uptime_rules.end_time is
  'If end_time <= start_time, the window crosses midnight (e.g., 22:00..02:00 = 10pm through 2am next day).';
