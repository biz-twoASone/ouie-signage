begin;
select plan(3);

-- Simulate auth.users insert (mimics what Supabase does on sign-up).
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
values (
  '00000000-0000-0000-0000-000000000011',
  'newbie@example.com',
  '{}'::jsonb,
  '{}'::jsonb,
  'authenticated',
  'authenticated'
);

select is(
  (select count(*)::int from public.tenants t
    join public.tenant_members tm on tm.tenant_id = t.id
    where tm.user_id = '00000000-0000-0000-0000-000000000011'),
  1,
  'new user has exactly one tenant_members row'
);

select is(
  (select role from public.tenant_members
    where user_id = '00000000-0000-0000-0000-000000000011'),
  'owner',
  'role is owner'
);

select is(
  (select t.name from public.tenants t
    join public.tenant_members tm on tm.tenant_id = t.id
    where tm.user_id = '00000000-0000-0000-0000-000000000011'),
  'newbie''s workspace',
  'tenant name derived from email local-part'
);

select * from finish();
rollback;
