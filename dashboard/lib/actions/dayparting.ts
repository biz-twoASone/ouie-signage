"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type RuleInput = {
  name: string;
  target_type: "device" | "device_group";
  target_id: string;
  days_of_week: number[];        // ISO day numbers 1..7 (1=Monday, 7=Sunday) — matches schema CHECK
  start_time: string;            // HH:MM
  end_time: string;              // HH:MM — schema permits end < start (crosses midnight)
  playlist_id: string;
  effective_at: string;          // ISO timestamp
};

function validate(input: RuleInput): string | null {
  if (!input.name.trim()) return "Name required.";
  if (!Array.isArray(input.days_of_week) || input.days_of_week.length === 0) return "Pick at least one day.";
  if (input.days_of_week.some(d => d < 1 || d > 7)) return "Invalid day (must be 1–7).";
  if (!/^\d{2}:\d{2}$/.test(input.start_time)) return "Start must be HH:MM.";
  if (!/^\d{2}:\d{2}$/.test(input.end_time)) return "End must be HH:MM.";
  if (!input.target_id) return "Pick a target.";
  if (!input.playlist_id) return "Pick a playlist.";
  return null;
}

function toRow(tenantId: string, userId: string, input: RuleInput) {
  return {
    tenant_id: tenantId,
    target_device_id: input.target_type === "device" ? input.target_id : null,
    target_device_group_id: input.target_type === "device_group" ? input.target_id : null,
    days_of_week: input.days_of_week,
    start_time: input.start_time,
    end_time: input.end_time,
    playlist_id: input.playlist_id,
    effective_at: input.effective_at,
    created_by: userId,
  };
}

export async function createRule(input: RuleInput) {
  const err = validate(input);
  if (err) return { error: err };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: tm } = await supabase.from("tenant_members").select("tenant_id").maybeSingle();
  if (!tm) return { error: "No tenant context." };
  const row = { ...toRow(tm.tenant_id, user.id, input), label: input.name.trim() };
  const { error } = await supabase.from("dayparting_rules").insert(row);
  if (error) return { error: error.message };
  revalidatePath("/app/schedules");
  redirect("/app/schedules");
}

export async function updateRule(id: string, input: RuleInput) {
  const err = validate(input);
  if (err) return { error: err };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: tm } = await supabase.from("tenant_members").select("tenant_id").maybeSingle();
  if (!tm) return { error: "No tenant context." };
  const row = { ...toRow(tm.tenant_id, user.id, input), label: input.name.trim() };
  const { error } = await supabase.from("dayparting_rules").update(row).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/schedules");
  revalidatePath(`/app/schedules/${id}`);
  redirect("/app/schedules");
}

export async function deleteRule(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("dayparting_rules").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app/schedules");
  redirect("/app/schedules");
}
