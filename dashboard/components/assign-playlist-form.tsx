"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Playlist = { id: string; name: string };
type Props = {
  current: string | null;
  playlists: Playlist[];
  onSubmit: (id: string | null) => Promise<{ error?: string } | void>;
};

export function AssignPlaylistForm({ current, playlists, onSubmit }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-2 max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const raw = String(new FormData(e.currentTarget).get("playlist_id") ?? "");
        const playlistId = raw === "" ? null : raw;
        start(async () => {
          const r = await onSubmit(playlistId);
          if (r && "error" in r && r.error) setError(r.error);
        });
      }}
    >
      <Label htmlFor="playlist_id">Fallback playlist (plays 24/7 unless a dayparting rule overrides)</Label>
      <div className="flex gap-2">
        <select name="playlist_id" defaultValue={current ?? ""} className="border rounded h-10 flex-1 px-3">
          <option value="">— none —</option>
          {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Button type="submit" disabled={pending}>{pending ? "…" : "Save"}</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
