import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { DeviceStatusBadge } from "@/components/device-status-badge";
import { RenameDeviceForm } from "@/components/rename-device-form";
import { renameDevice, deleteDevice } from "@/lib/actions/devices";
import { Button } from "@/components/ui/button";
import { SyncNowButton } from "@/components/sync-now-button";
import { syncNow } from "@/lib/actions/devices";

export default async function DeviceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: device } = await supabase
    .from("devices")
    .select(`
      id, name, store_id, last_seen_at, fcm_token, fallback_playlist_id,
      cache_storage_info, stores(name, timezone)
    `)
    .eq("id", id)
    .maybeSingle();
  if (!device) notFound();

  async function rename(name: string) {
    "use server";
    return await renameDevice(id, name);
  }
  async function remove() {
    "use server";
    await deleteDevice(id);
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
        <DeviceStatusBadge last_seen_at={device.last_seen_at} />
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
        {/* Extended heartbeat fields (app version, current playlist, config version, clock skew)
            are surfaced in Task 21 once the schema migration adds the columns. */}
      </section>

      <SyncNowButton onClick={async () => {
        "use server";
        return await syncNow(id);
      }} />

      <RenameDeviceForm initialName={device.name} onSubmit={rename} />

      <form action={remove}>
        <Button type="submit" variant="destructive">Delete device</Button>
      </form>
    </div>
  );
}
