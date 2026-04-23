import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui-composed/page-header";
import { StatusPill } from "@/components/ui-composed/status-pill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineEdit } from "@/components/ui-composed/inline-edit";
import { copy } from "@/lib/copy";
import { renameDevice, deleteDevice, syncNow, assignFallbackPlaylist } from "@/lib/actions/devices";
import { SyncNowButton } from "@/components/sync-now-button";
import { AssignPlaylistForm } from "@/components/assign-playlist-form";
import { DeleteScreenButton } from "./delete-screen-button";
import { UptimeRulesSection, type UptimeRule } from "@/components/uptime-rules-section";

const OFFLINE_MS = 5 * 60 * 1000;

export default async function ScreenDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [
    { data: device },
    { data: playlists },
    { data: recentCache },
    { data: uptimeRules },
    { data: recentErrors },
  ] = await Promise.all([
    supabase.from("devices").select(`
      id, name, store_id, last_seen_at, fcm_token, fallback_playlist_id,
      cache_storage_info, current_app_version, current_playlist_id,
      last_config_version_applied, clock_skew_seconds_from_server,
      last_fcm_received_at, last_sync_now_dispatched_at,
      stores(name, timezone)
    `).eq("id", id).maybeSingle(),
    supabase.from("playlists").select("id, name").order("name"),
    supabase.from("cache_events")
      .select("created_at, state, media_id, message")
      .eq("device_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.from("screen_uptime_rules")
      .select("id, days_of_week, start_time, end_time")
      .eq("target_device_id", id)
      .order("start_time"),
    supabase.from("device_error_events")
      .select("occurred_at, kind, media_id, message, media(name)")
      .eq("device_id", id)
      .order("occurred_at", { ascending: false })
      .limit(10),
  ]);
  if (!device) notFound();

  const online =
    !!device.last_seen_at &&
    // eslint-disable-next-line react-hooks/purity
    Date.now() - new Date(device.last_seen_at).getTime() < OFFLINE_MS;

  const storeName = (device.stores as unknown as { name: string } | null)?.name;

  async function rename(name: string) {
    "use server";
    await renameDevice(id, name);
  }
  async function remove() {
    "use server";
    await deleteDevice(id);
  }
  async function assign(playlistId: string | null) {
    "use server";
    return await assignFallbackPlaylist(id, playlistId);
  }

  const cache = device.cache_storage_info as {
    root?: string; total_bytes?: number; free_bytes?: number; filesystem?: string;
  } | null;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={
          <InlineEdit value={device.name} onSave={rename} data-testid="screen-detail-name" />
        }
        description={storeName ? `${copy.location}: ${storeName}` : ""}
        primaryAction={
          <SyncNowButton
            data-testid="screen-detail-sync-now"
            onClick={async () => {
              "use server";
              return await syncNow(id);
            }}
          />
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm">Status</CardTitle></CardHeader>
          <CardContent>
            <StatusPill
              variant={online ? "online" : "offline"}
              timestamp={device.last_seen_at ? new Date(device.last_seen_at).toLocaleTimeString() : undefined}
              data-testid="screen-detail-status"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">App version</CardTitle></CardHeader>
          <CardContent className="text-muted-foreground font-mono text-sm">
            {device.current_app_version ?? "—"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Clock skew</CardTitle></CardHeader>
          <CardContent className="text-muted-foreground font-mono text-sm">
            {device.clock_skew_seconds_from_server ?? 0}s
          </CardContent>
        </Card>
      </div>

      {device.last_sync_now_dispatched_at && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Last Sync Now</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {(() => {
              const dispatched = new Date(device.last_sync_now_dispatched_at);
              const received = device.last_fcm_received_at
                ? new Date(device.last_fcm_received_at)
                : null;
              const delivered = received && received >= dispatched;
              const secsSinceDispatch = Math.floor((Date.now() - dispatched.getTime()) / 1000);
              if (delivered) {
                const latencyMs = received.getTime() - dispatched.getTime();
                const latency = (latencyMs / 1000).toFixed(1);
                return (
                  <span className="text-emerald-600">
                    Delivered in {latency}s
                  </span>
                );
              }
              // Not delivered yet. Threshold 60s matches ConfigPoller.intervalMs —
              // if push takes longer than one poll cycle, poll already covers it.
              if (secsSinceDispatch < 60) {
                return (
                  <span className="text-muted-foreground">
                    Dispatched {secsSinceDispatch}s ago, awaiting delivery
                  </span>
                );
              }
              return (
                <span className="text-destructive">
                  Not delivered ({secsSinceDispatch}s ago) — FCM push failed or was filtered
                </span>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {cache && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Cache storage</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {cache.root ?? "?"} ({cache.filesystem ?? "?"}) —
            {" "}{Math.round((cache.free_bytes ?? 0) / 1e9)} GB free
            {" / "}{Math.round((cache.total_bytes ?? 0) / 1e9)} GB total
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Recent cache events</CardTitle></CardHeader>
        <CardContent>
          {(!recentCache || recentCache.length === 0) ? (
            <p className="text-muted-foreground text-sm">No recent events.</p>
          ) : (
            <ul className="space-y-1">
              {recentCache.map((e, i) => (
                <li key={i} className="text-xs">
                  <span className="text-muted-foreground">{e.created_at} </span>
                  <span className="font-mono">{e.state}</span>
                  {e.media_id && <span> · media {e.media_id.slice(0, 8)}…</span>}
                  {e.message && <span> · {e.message}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Recent errors</CardTitle></CardHeader>
        <CardContent>
          {(!recentErrors || recentErrors.length === 0) ? (
            <p className="text-muted-foreground text-sm">No errors recorded.</p>
          ) : (
            <ul className="space-y-1">
              {recentErrors.map((e, i) => {
                const mediaName = (e.media as unknown as { name: string } | null)?.name;
                return (
                  <li key={i} className="text-xs">
                    <span className="text-muted-foreground">{e.occurred_at} </span>
                    <span className="font-mono">{e.kind}</span>
                    {mediaName && <span> · {mediaName}</span>}
                    {e.message && <span> · {e.message}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Playlist assignment</CardTitle></CardHeader>
        <CardContent>
          <AssignPlaylistForm
            current={device.fallback_playlist_id}
            playlists={playlists ?? []}
            onSubmit={assign}
          />
        </CardContent>
      </Card>

      <UptimeRulesSection
        rules={(uptimeRules ?? []) as UptimeRule[]}
        target={{ device_id: id }}
      />

      <Card className="border-destructive/50">
        <CardHeader><CardTitle className="text-destructive text-base">Danger zone</CardTitle></CardHeader>
        <CardContent>
          <DeleteScreenButton onConfirm={remove} screenName={device.name} />
        </CardContent>
      </Card>
    </div>
  );
}
