import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui-composed/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: member } = await supabase
    .from("tenant_members")
    .select("tenant:tenants(id, name, created_at)")
    .eq("user_id", user!.id)
    .maybeSingle();
  const tenant = member?.tenant as unknown as {
    id: string;
    name: string;
    created_at: string;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Account and workspace configuration."
      />
      <div className="grid gap-6 md:grid-cols-2">
        <Card data-testid="settings-account-card">
          <CardHeader><CardTitle className="text-base">Account</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Email</span>
              <span className="font-mono text-xs">{user?.email}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Signed in since</span>
              <span className="font-mono text-xs">
                {new Date(user?.last_sign_in_at ?? user?.created_at ?? "").toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="settings-workspace-card">
          <CardHeader><CardTitle className="text-base">Workspace</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Name</span>
              <span>{tenant?.name}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Created</span>
              <span className="font-mono text-xs">
                {tenant ? new Date(tenant.created_at).toLocaleDateString() : "—"}
              </span>
            </div>
            <p className="text-muted-foreground pt-2 text-xs">
              Workspace rename + team management coming soon.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
