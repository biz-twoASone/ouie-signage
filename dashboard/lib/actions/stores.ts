"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type StoreInput = {
  name: string;
  timezone: string;
  sync_window_start: string;
  sync_window_end: string;
};

function validate(input: StoreInput): string | null {
  if (!input.name.trim()) return "Name is required.";
  if (!/^[A-Za-z_]+\/[A-Za-z_]+$/.test(input.timezone)) return "Timezone must be an IANA identifier like Asia/Jakarta.";
  if (!/^\d{2}:\d{2}$/.test(input.sync_window_start)) return "Sync start must be HH:MM.";
  if (!/^\d{2}:\d{2}$/.test(input.sync_window_end)) return "Sync end must be HH:MM.";
  return null;
}

export async function createStore(input: StoreInput) {
  const err = validate(input);
  if (err) return { error: err };
  const supabase = await createClient();
  const { data: tm } = await supabase.from("tenant_members").select("tenant_id").maybeSingle();
  if (!tm) return { error: "No tenant context." };

  const { error } = await supabase.from("stores").insert({
    tenant_id: tm.tenant_id,
    name: input.name.trim(),
    timezone: input.timezone,
    sync_window_start: input.sync_window_start,
    sync_window_end: input.sync_window_end,
  });
  if (error) return { error: error.message };
  revalidatePath("/app/locations");
  redirect("/app/locations");
}

export async function updateStore(id: string, input: StoreInput) {
  const err = validate(input);
  if (err) return { error: err };
  const supabase = await createClient();
  const { error } = await supabase.from("stores").update({
    name: input.name.trim(),
    timezone: input.timezone,
    sync_window_start: input.sync_window_start,
    sync_window_end: input.sync_window_end,
  }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/locations");
  revalidatePath(`/app/locations/${id}`);
  redirect("/app/locations");
}

export async function deleteStore(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("stores").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/locations");
  redirect("/app/locations");
}

export async function assignPlaylistToAllDevicesInStore(
  storeId: string, playlistId: string | null,
) {
  const supabase = await createClient();
  const { error } = await supabase.from("devices")
    .update({ fallback_playlist_id: playlistId })
    .eq("store_id", storeId);
  if (error) return { error: error.message };
  revalidatePath("/app/locations");
  revalidatePath(`/app/locations/${storeId}`);
  revalidatePath("/app/screens");
}
