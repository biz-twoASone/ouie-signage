create table public.alert_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index alert_events_tenant_kind_time_idx
  on public.alert_events (tenant_id, kind, created_at desc);

alter table public.alert_events enable row level security;

create policy "alert_events: tenant members read"
  on public.alert_events for select
  using (tenant_id in (select tenant_id from public.tenant_members where user_id = auth.uid()));
-- No insert/update/delete for humans; only the Edge Function via service_role.
