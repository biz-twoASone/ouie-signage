"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createPlaylist(name: string) {
  if (!name.trim()) return { error: "Name required." };
  const supabase = await createClient();
  const { data: tm } = await supabase.from("tenant_members").select("tenant_id").maybeSingle();
  if (!tm) return { error: "No tenant context." };
  const { data, error } = await supabase.from("playlists")
    .insert({ tenant_id: tm.tenant_id, name: name.trim() })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/app/playlists");
  redirect(`/app/playlists/${data.id}`);
}

export async function renamePlaylist(id: string, name: string) {
  if (!name.trim()) return { error: "Name required." };
  const supabase = await createClient();
  const { error } = await supabase.from("playlists").update({ name: name.trim() }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/playlists");
  revalidatePath(`/app/playlists/${id}`);
}

export async function deletePlaylist(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("playlists").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/playlists");
  redirect("/app/playlists");
}

export async function addPlaylistItem(
  playlistId: string, mediaId: string, durationSeconds?: number,
) {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("playlist_items")
    .select("position")
    .eq("playlist_id", playlistId)
    .order("position", { ascending: false })
    .limit(1);
  const nextOrder = (existing?.[0]?.position ?? -1) + 1;
  const { error } = await supabase.from("playlist_items").insert({
    playlist_id: playlistId,
    media_id: mediaId,
    position: nextOrder,
    duration_seconds: durationSeconds ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/app/playlists/${playlistId}`);
}

export async function removePlaylistItem(playlistId: string, itemId: string) {
  const supabase = await createClient();
  // After delete, compact positions so there are no holes (keeps the UNIQUE
  // (playlist_id, position) constraint tidy and keeps 0..n-1 contiguous).
  const { error: delErr } = await supabase.from("playlist_items").delete().eq("id", itemId);
  if (delErr) return { error: delErr.message };

  const { data: remaining, error: selErr } = await supabase
    .from("playlist_items")
    .select("id")
    .eq("playlist_id", playlistId)
    .order("position", { ascending: true });
  if (selErr) return { error: selErr.message };
  if (remaining && remaining.length > 0) {
    const ids = remaining.map(r => r.id);
    const res = await reorderPlaylistItems(playlistId, ids);
    if (res && "error" in res && res.error) return { error: res.error };
  }
  revalidatePath(`/app/playlists/${playlistId}`);
}

// Two-phase reorder avoids violating UNIQUE (playlist_id, position):
// phase 1 bumps everyone into a "scratch range" (10000+i); phase 2 assigns
// final 0..n-1. Without this, sequential updates collide whenever a later
// item is moved earlier.
export async function reorderPlaylistItems(playlistId: string, orderedItemIds: string[]) {
  const supabase = await createClient();
  for (let i = 0; i < orderedItemIds.length; i++) {
    const { error } = await supabase.from("playlist_items")
      .update({ position: 10000 + i })
      .eq("id", orderedItemIds[i]);
    if (error) return { error: error.message };
  }
  for (let i = 0; i < orderedItemIds.length; i++) {
    const { error } = await supabase.from("playlist_items")
      .update({ position: i })
      .eq("id", orderedItemIds[i]);
    if (error) return { error: error.message };
  }
  revalidatePath(`/app/playlists/${playlistId}`);
}

export async function updateItemDuration(itemId: string, durationSeconds: number | null, playlistId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("playlist_items")
    .update({ duration_seconds: durationSeconds })
    .eq("id", itemId);
  if (error) return { error: error.message };
  revalidatePath(`/app/playlists/${playlistId}`);
}
