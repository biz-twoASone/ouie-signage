import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { StoreForm } from "@/components/store-form";
import { updateStore, deleteStore } from "@/lib/actions/stores";
import { Button } from "@/components/ui/button";
import { AssignPlaylistForm } from "@/components/assign-playlist-form";
import { assignPlaylistToAllDevicesInStore } from "@/lib/actions/stores";

export default async function EditStorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: store } = await supabase
    .from("stores")
    .select("id, name, timezone, sync_window_start, sync_window_end")
    .eq("id", id)
    .maybeSingle();
  if (!store) notFound();

  const [{ data: playlists }, { data: devicesInStore }] = await Promise.all([
    supabase.from("playlists").select("id, name").order("name"),
    supabase.from("devices").select("id, fallback_playlist_id").eq("store_id", id),
  ]);

  // null if mixed; the single common value if all devices share one; null if none.
  const common: string | null = (() => {
    const ids = new Set((devicesInStore ?? []).map(d => d.fallback_playlist_id));
    return ids.size === 1 ? (devicesInStore?.[0]?.fallback_playlist_id ?? null) : null;
  })();

  async function assignAll(playlistId: string | null) {
    "use server";
    return await assignPlaylistToAllDevicesInStore(id, playlistId);
  }

  async function save(input: Parameters<typeof updateStore>[1]) {
    "use server";
    return await updateStore(id, input);
  }

  async function remove() {
    "use server";
    await deleteStore(id);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Edit store</h1>
      <StoreForm
        initial={{
          name: store.name,
          timezone: store.timezone,
          sync_window_start: store.sync_window_start,
          sync_window_end: store.sync_window_end,
        }}
        onSubmit={save}
        submitLabel="Save"
      />
      <section className="border rounded p-4 space-y-2">
        <h2 className="font-medium">Assign playlist to all TVs in this store</h2>
        <p className="text-sm text-muted-foreground">
          {devicesInStore?.length ?? 0} devices. {common === null && (devicesInStore?.length ?? 0) > 0 ? "(currently mixed assignments)" : ""}
        </p>
        <AssignPlaylistForm current={common} playlists={playlists ?? []} onSubmit={assignAll} />
      </section>
      <form action={remove}>
        <Button type="submit" variant="destructive">Delete store</Button>
      </form>
    </div>
  );
}
