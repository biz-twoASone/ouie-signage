"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type ClaimInput = { code: string; store_id: string; name?: string };

export async function claimPairingCode(input: ClaimInput) {
  if (!/^[A-Z0-9]{6}$/.test(input.code)) return { error: "Code must be 6 letters/digits." };
  if (!input.store_id) return { error: "Pick a store." };

  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: "Not signed in." };

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/pairing-claim`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      code: input.code.toUpperCase(),
      store_id: input.store_id,
      name: input.name?.trim() || "TV",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { error: `Pairing failed: ${res.status} ${text}` };
  }
  revalidatePath("/app/screens");
  redirect("/app/screens");
}

export async function renameDevice(id: string, name: string) {
  if (!name.trim()) return { error: "Name required." };
  const supabase = await createClient();
  const { error } = await supabase.from("devices").update({ name: name.trim() }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/screens");
  revalidatePath(`/app/screens/${id}`);
}

export async function deleteDevice(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("devices").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/screens");
  redirect("/app/screens");
}

export async function syncNow(deviceId: string) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: "Not signed in." };

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/devices-sync-now`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (res.status !== 202) {
    const text = await res.text();
    return { error: `Sync failed: ${res.status} ${text}` };
  }
  return { ok: true };
}

export async function assignFallbackPlaylist(deviceId: string, playlistId: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.from("devices")
    .update({ fallback_playlist_id: playlistId })
    .eq("id", deviceId);
  if (error) return { error: error.message };
  revalidatePath(`/app/screens/${deviceId}`);
  revalidatePath("/app/screens");
  revalidatePath("/app");
}
