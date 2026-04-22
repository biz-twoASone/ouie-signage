"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createGroup(name: string) {
  if (!name.trim()) return { error: "Name required." };
  const supabase = await createClient();
  const { data: tm } = await supabase.from("tenant_members").select("tenant_id").maybeSingle();
  if (!tm) return { error: "No tenant context." };
  const { data, error } = await supabase.from("device_groups")
    .insert({ tenant_id: tm.tenant_id, name: name.trim() })
    .select("id").single();
  if (error) return { error: error.message };
  revalidatePath("/app/device-groups");
  redirect(`/app/device-groups/${data.id}`);
}

export async function renameGroup(id: string, name: string) {
  if (!name.trim()) return { error: "Name required." };
  const supabase = await createClient();
  const { error } = await supabase.from("device_groups").update({ name: name.trim() }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/device-groups");
  revalidatePath(`/app/device-groups/${id}`);
}

export async function deleteGroup(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("device_groups").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/device-groups");
  redirect("/app/device-groups");
}

export async function setGroupMembers(groupId: string, deviceIds: string[]) {
  const supabase = await createClient();
  // Wipe + insert. At 8-device scale this is simpler than diffing.
  const { error: delErr } = await supabase.from("device_group_members")
    .delete().eq("device_group_id", groupId);
  if (delErr) return { error: delErr.message };
  if (deviceIds.length > 0) {
    const { error: insErr } = await supabase.from("device_group_members")
      .insert(deviceIds.map(did => ({ device_group_id: groupId, device_id: did })));
    if (insErr) return { error: insErr.message };
  }
  revalidatePath(`/app/device-groups/${groupId}`);
  revalidatePath("/app/device-groups");
}
