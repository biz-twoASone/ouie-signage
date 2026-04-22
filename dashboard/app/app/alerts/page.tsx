import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui-composed/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertsForm } from "./alerts-form";
import { ActivityItem } from "@/components/ui-composed/activity-item";
import { EmptyState } from "@/components/ui-composed/empty-state";
import { BellRing, AlertTriangle } from "lucide-react";
import { formatDistanceToNowStrict } from "../format-relative";

export default async function AlertsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: member } = await supabase
    .from("tenant_members")
    .select("tenant:tenants(id, alerts_enabled, alert_offline_threshold_minutes, alert_recipient_email)")
    .eq("user_id", user!.id)
    .maybeSingle();

  const tenant = member!.tenant as unknown as {
    id: string;
    alerts_enabled: boolean;
    alert_offline_threshold_minutes: number;
    alert_recipient_email: string | null;
  };

  const { data: events } = await supabase
    .from("alert_events")
    .select("id, kind, payload, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts"
        description="Get notified when screens go offline for too long."
      />
      <div className="grid gap-6 md:grid-cols-2">
        <Card data-testid="alerts-config-card">
          <CardHeader>
            <CardTitle className="text-base">Notification settings</CardTitle>
          </CardHeader>
          <CardContent>
            <AlertsForm
              initial={{
                alerts_enabled: tenant.alerts_enabled,
                alert_offline_threshold_minutes:
                  tenant.alert_offline_threshold_minutes,
                alert_recipient_email: tenant.alert_recipient_email ?? "",
              }}
              ownerEmail={user!.email ?? ""}
            />
          </CardContent>
        </Card>

        <Card data-testid="alerts-log-card">
          <CardHeader>
            <CardTitle className="text-base">Recent alerts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 p-3 pt-0">
            {(events ?? []).length === 0 ? (
              <EmptyState
                icon={BellRing}
                title="No alerts yet"
                description="When a screen goes offline past your threshold, the event shows up here."
              />
            ) : (
              (events ?? []).map((e) => {
                const count =
                  (e.payload as { device_ids?: string[] })?.device_ids?.length ?? 0;
                return (
                  <ActivityItem
                    key={e.id}
                    icon={AlertTriangle}
                    timestamp={formatDistanceToNowStrict(new Date(e.created_at))}
                    tone="warning"
                  >
                    {count} screen{count === 1 ? "" : "s"} offline
                  </ActivityItem>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
