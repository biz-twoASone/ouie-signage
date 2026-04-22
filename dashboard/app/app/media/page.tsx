import { createClient } from "@/lib/supabase/server";
import { MediaUploader } from "@/components/media-uploader";
import { deleteMedia } from "@/lib/actions/media";
import { PageHeader } from "@/components/ui-composed/page-header";
import { EmptyState } from "@/components/ui-composed/empty-state";
import { Button } from "@/components/ui/button";
import { Film, FileImage, Image as ImageIcon, Trash2 } from "lucide-react";
import { copy } from "@/lib/copy";

export default async function MediaPage() {
  const supabase = await createClient();
  const { data: media } = await supabase
    .from("media")
    .select("id, original_filename, mime_type, kind, size_bytes, video_duration_seconds, upload_state, uploaded_at")
    .order("uploaded_at", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.media}
        description="Images and videos available to any playlist."
      />

      <MediaUploader />

      {(!media || media.length === 0) ? (
        <EmptyState
          icon={ImageIcon}
          title="No media yet"
          description="Upload an image or video above to get started."
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4" data-testid="media-grid">
          {media.map((m) => {
            async function remove() {
              "use server";
              await deleteMedia(m.id);
            }
            const Icon = (m.mime_type ?? "").startsWith("video/") ? Film : FileImage;
            return (
              <li
                key={m.id}
                data-testid={`media-tile-${m.id}`}
                className="group border-border bg-card hover:border-primary/50 relative flex flex-col overflow-hidden rounded-lg border transition-colors"
              >
                <div className="bg-muted text-muted-foreground flex aspect-video items-center justify-center">
                  <Icon className="h-8 w-8" strokeWidth={1.5} />
                </div>
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <p className="truncate text-sm font-medium" title={m.original_filename}>
                    {m.original_filename}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {Math.round(m.size_bytes / 1024)} KB
                    {m.video_duration_seconds ? ` · ${m.video_duration_seconds}s` : ""}
                    {" · "}
                    <span className={m.upload_state === "uploaded" ? "" : "text-status-warning"}>
                      {m.upload_state}
                    </span>
                  </p>
                </div>
                <form action={remove} className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    type="submit"
                    size="icon"
                    variant="destructive"
                    aria-label={`Delete ${m.original_filename}`}
                    data-testid={`media-tile-${m.id}-delete`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
