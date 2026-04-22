import { createClient } from "@/lib/supabase/server";
import { MediaUploader } from "@/components/media-uploader";
import { deleteMedia } from "@/lib/actions/media";
import { Button } from "@/components/ui/button";

export default async function MediaPage() {
  const supabase = await createClient();
  const { data: media } = await supabase
    .from("media")
    .select("id, original_filename, mime_type, kind, size_bytes, video_duration_seconds, upload_state, uploaded_at")
    .order("uploaded_at", { ascending: false });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Media library</h1>
      <MediaUploader />
      <ul className="space-y-2">
        {(media ?? []).map((m) => {
          async function remove() {
            "use server";
            await deleteMedia(m.id);
          }
          return (
            <li key={m.id} className="border rounded p-3 flex justify-between items-center">
              <div className="flex-1">
                <div className="font-medium">{m.original_filename}</div>
                <div className="text-sm text-muted-foreground">
                  {m.mime_type ?? m.kind} · {Math.round(m.size_bytes / 1024)} KB
                  {m.video_duration_seconds ? ` · ${m.video_duration_seconds}s` : ""}
                  {" · "}<span className={m.upload_state === "uploaded" ? "" : "text-amber-600"}>{m.upload_state}</span>
                </div>
              </div>
              <form action={remove}>
                <Button type="submit" variant="ghost" size="sm">Delete</Button>
              </form>
            </li>
          );
        })}
        {(!media || media.length === 0) && (
          <li className="text-muted-foreground text-sm">No media uploaded yet.</li>
        )}
      </ul>
    </div>
  );
}
