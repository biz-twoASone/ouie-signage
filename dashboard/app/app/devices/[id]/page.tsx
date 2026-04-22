import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { DeviceStatusBadge } from "@/components/device-status-badge";
import { RenameDeviceForm } from "@/components/rename-device-form";
import { renameDevice, deleteDevice } from "@/lib/actions/devices";
import { Button } from "@/components/ui/button";
import { SyncNowButton } from "@/components/sync-now-button";
import { syncNow } from "@/lib/actions/devices";
import { AssignPlaylistForm } from "@/components/assign-playlist-form";
import { assignFallbackPlaylist } from "@/lib/actions/devices";

export default async function DeviceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: device }, { data: playlists }, { data: recentCache }] = await Promise.all([
    supabase.from("devices").select(`
      id, name, store_id, last_seen_at, fcm_token, fallback_playlist_id,
      cache_storage_info, current_app_version, current_playlist_id,
      last_config_version_applied, clock_skew_seconds_from_server,
      stores(name, timezone)
    `).eq("id", id).maybeSingle(),
    supabase.from("playlists").select("id, name").order("name"),
    supabase.from("cache_events")
      .select("created_at, state, media_id, message")
      .eq("device_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  if (!device) notFound();

  async function rename(name: string) {
    "use server";
    return await renameDevice(id, name);
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
    <div className="space-y-6 max-w-2xl">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-semibold">{device.name}</h1>
          <p className="text-muted-foreground text-sm">
            {(device.stores as unknown as { name: string } | null)?.name}
          </p>
        </div>
        <DeviceStatusBadge
          last_seen_at={device.last_seen_at}
          clock_skew_seconds={device.clock_skew_seconds_from_server}
        />
      </div>

      <section className="border rounded p-4 space-y-2 text-sm">
        <div><span className="text-muted-foreground">Last seen: </span>{device.last_seen_at ?? "never"}</div>
        {cache && (
          <div>
            <span className="text-muted-foreground">Cache storage: </span>
            {cache.root ?? "?"} ({cache.filesystem ?? "?"}) —
            {" "}{Math.round((cache.free_bytes ?? 0) / 1e9)} GB free
            {" / "}{Math.round((cache.total_bytes ?? 0) / 1e9)} GB total
          </div>
        )}
        {device.current_app_version && (
          <div><span className="text-muted-foreground">App version: </span>{device.current_app_version}</div>
        )}
        {device.last_config_version_applied && (
          <div><span className="text-muted-foreground">Config version: </span>{device.last_config_version_applied}</div>
        )}
        {device.clock_skew_seconds_from_server !== null && device.clock_skew_seconds_from_server !== undefined && (
          <div><span className="text-muted-foreground">Clock skew: </span>{device.clock_skew_seconds_from_server}s</div>
        )}
      </section>

      <section className="border rounded p-4 space-y-2 text-sm">
        <h2 className="font-medium">Recent cache events</h2>
        {(!recentCache || recentCache.length === 0) ? (
          <p className="text-muted-foreground">No recent events.</p>
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
      </section>

      <SyncNowButton onClick={async () => {
        "use server";
        return await syncNow(id);
      }} />

      <section className="border rounded p-4 space-y-2">
        <h2 className="font-medium">Playlist assignment</h2>
        <AssignPlaylistForm current={device.fallback_playlist_id} playlists={playlists ?? []} onSubmit={assign} />
      </section>

      <RenameDeviceForm initialName={device.name} onSubmit={rename} />

      <form action={remove}>
        <Button type="submit" variant="destructive">Delete device</Button>
      </form>
    </div>
  );
}
