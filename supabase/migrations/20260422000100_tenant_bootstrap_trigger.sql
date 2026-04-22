-- Auto-create a tenant and tenant_members row on first sign-in. The first user
-- who signs in becomes owner of their own single-tenant workspace. This is the
-- "multi-tenant schema, single-tenant UX" discipline in action: schema allows
-- N tenants; v1 operator just sees their own.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_tenant_id uuid;
  display_name text;
begin
  -- Derive a friendly tenant name from the email local-part.
  display_name := split_part(coalesce(new.email, 'user'), '@', 1);

  insert into public.tenants (name)
  values (display_name || '''s workspace')
  returning id into new_tenant_id;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (new_tenant_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
