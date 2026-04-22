import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { PlaylistComposer } from "@/components/playlist-composer";
import { deletePlaylist, renamePlaylist } from "@/lib/actions/playlists";
import { PageHeader } from "@/components/ui-composed/page-header";
import { InlineEdit } from "@/components/ui-composed/inline-edit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeletePlaylistButton } from "./delete-playlist-button";

export default async function PlaylistDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: playlist }, { data: items }, { data: media }] = await Promise.all([
    supabase.from("playlists").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("playlist_items")
      .select("id, media_id, position, duration_seconds, media(id, original_filename, mime_type, video_duration_seconds)")
      .eq("playlist_id", id),
    supabase.from("media")
      .select("id, original_filename, mime_type, video_duration_seconds")
      .eq("upload_state", "uploaded")
      .order("uploaded_at", { ascending: false }),
  ]);
  if (!playlist) notFound();

  async function rename(name: string) {
    "use server";
    await renamePlaylist(id, name);
  }
  async function remove() {
    "use server";
    await deletePlaylist(id);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={
          <InlineEdit
            value={playlist.name}
            onSave={rename}
            data-testid="playlist-detail-name"
          />
        }
        description="Drag to reorder items. Per-item duration defaults to the media's own length for videos."
      />

      <PlaylistComposer
        playlistId={id}
        items={(items ?? []).map(i => ({
          id: i.id, media_id: i.media_id, position: i.position,
          duration_seconds: i.duration_seconds,
          media: i.media as unknown as { id: string; original_filename: string; mime_type: string | null; video_duration_seconds: number | null } | null,
        }))}
        media={media ?? []}
      />

      <Card className="border-destructive/50">
        <CardHeader><CardTitle className="text-destructive text-base">Danger zone</CardTitle></CardHeader>
        <CardContent>
          <DeletePlaylistButton onConfirm={remove} playlistName={playlist.name} />
        </CardContent>
      </Card>
    </div>
  );
}
