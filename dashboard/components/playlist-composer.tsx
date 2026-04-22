"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SortableItems } from "@/components/sortable-items";
import {
  addPlaylistItem, removePlaylistItem, reorderPlaylistItems,
  updateItemDuration,
} from "@/lib/actions/playlists";

type Media = { id: string; original_filename: string; mime_type: string | null; video_duration_seconds: number | null };
type Item = { id: string; media_id: string; position: number; duration_seconds: number | null; media: Media | null };

type Props = {
  playlistId: string;
  items: Item[];
  media: Media[];
};

export function PlaylistComposer({ playlistId, items, media }: Props) {
  const [pending, start] = useTransition();

  function handleAdd(mediaId: string) {
    const m = media.find(x => x.id === mediaId);
    start(async () => { await addPlaylistItem(playlistId, mediaId, m?.video_duration_seconds ?? undefined); });
  }

  function handleRemove(itemId: string) {
    start(async () => { await removePlaylistItem(playlistId, itemId); });
  }

  function handleReorder(ids: string[]) {
    start(async () => { await reorderPlaylistItems(playlistId, ids); });
  }

  function handleDuration(itemId: string, value: string) {
    const n = parseInt(value, 10);
    start(async () => { await updateItemDuration(itemId, Number.isFinite(n) && n > 0 ? n : null, playlistId); });
  }

  const orderedItems = [...items].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-medium mb-2">Items (drag to reorder)</h2>
        {orderedItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">Playlist is empty. Add media below.</p>
        ) : (
          <SortableItems
            items={orderedItems.map(i => ({
              id: i.id,
              content: (
                <div className="flex items-center justify-between gap-3">
                  <span className="flex-1 truncate">{i.media?.original_filename ?? "(deleted media)"}</span>
                  <Input
                    type="number"
                    min={1}
                    className="w-24"
                    defaultValue={i.duration_seconds ?? ""}
                    placeholder="sec"
                    onBlur={(e) => handleDuration(i.id, e.target.value)}
                  />
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => handleRemove(i.id)}>
                    Remove
                  </Button>
                </div>
              ),
            }))}
            onReorder={handleReorder}
          />
        )}
      </section>

      <section>
        <h2 className="font-medium mb-2">Add media</h2>
        <ul className="space-y-2">
          {media.filter(m => !orderedItems.some(oi => oi.media_id === m.id)).map(m => (
            <li key={m.id} className="border rounded p-3 flex justify-between">
              <span>{m.original_filename}</span>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => handleAdd(m.id)}>
                Add to playlist
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
