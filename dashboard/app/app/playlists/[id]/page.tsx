import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { PlaylistComposer } from "@/components/playlist-composer";
import { deletePlaylist, renamePlaylist } from "@/lib/actions/playlists";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

  async function rename(fd: FormData) {
    "use server";
    await renamePlaylist(id, String(fd.get("name") ?? ""));
  }
  async function remove() {
    "use server";
    await deletePlaylist(id);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <form action={rename} className="flex gap-2">
        <Input name="name" defaultValue={playlist.name} required />
        <Button type="submit">Rename</Button>
      </form>

      <PlaylistComposer
        playlistId={id}
        items={(items ?? []).map(i => ({
          id: i.id, media_id: i.media_id, position: i.position,
          duration_seconds: i.duration_seconds,
          media: i.media as unknown as { id: string; original_filename: string; mime_type: string | null; video_duration_seconds: number | null } | null,
        }))}
        media={media ?? []}
      />

      <form action={remove}>
        <Button type="submit" variant="destructive">Delete playlist</Button>
      </form>
    </div>
  );
}
