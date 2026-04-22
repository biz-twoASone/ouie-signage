import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { StoreForm } from "@/components/store-form";
import { updateStore, deleteStore } from "@/lib/actions/stores";
import { AssignPlaylistForm } from "@/components/assign-playlist-form";
import { assignPlaylistToAllDevicesInStore } from "@/lib/actions/stores";
import { PageHeader } from "@/components/ui-composed/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteLocationButton } from "./delete-location-button";
import { copy } from "@/lib/copy";

export default async function LocationDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title={store.name}
        description={`${copy.location} settings and screen assignments.`}
      />

      <Card>
        <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
        <CardContent>
          <StoreForm
            initial={{
              name: store.name,
              timezone: store.timezone,
              sync_window_start: store.sync_window_start.slice(0, 5),
              sync_window_end: store.sync_window_end.slice(0, 5),
            }}
            onSubmit={save}
            submitLabel="Save location"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Assign playlist to all screens here</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-muted-foreground text-sm">
            {devicesInStore?.length ?? 0} screens.
            {common === null && (devicesInStore?.length ?? 0) > 0 ? " Currently mixed assignments." : ""}
          </p>
          <AssignPlaylistForm current={common} playlists={playlists ?? []} onSubmit={assignAll} />
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader><CardTitle className="text-destructive text-base">Danger zone</CardTitle></CardHeader>
        <CardContent>
          <DeleteLocationButton onConfirm={remove} locationName={store.name} />
        </CardContent>
      </Card>
    </div>
  );
}
