import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/ui-composed/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("tenant_members")
    .select("tenant:tenants(id, name)")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member?.tenant) redirect("/login");

  const tenant = member.tenant as unknown as { id: string; name: string };

  return (
    <AppShell
      userEmail={user.email ?? ""}
      currentTenant={tenant}
      tenants={[tenant]}
    >
      {children}
    </AppShell>
  );
}
