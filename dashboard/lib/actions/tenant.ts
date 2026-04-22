"use server";

import { createClient } from "@/lib/supabase/server";

export async function getCurrentTenant() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("tenant_members")
    .select("tenant_id, role, tenants(name)")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) return null;
  return {
    user_id: user.id,
    email: user.email,
    tenant_id: data.tenant_id,
    tenant_name: (data.tenants as unknown as { name: string } | null)?.name ?? "",
    role: data.role,
  };
}
