"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const alertConfigSchema = z.object({
  alerts_enabled: z.boolean(),
  alert_offline_threshold_minutes: z.number().int().min(5).max(1440),
  alert_recipient_email: z
    .string()
    .email()
    .or(z.literal(""))
    .transform((v) => (v === "" ? null : v)),
});

export async function updateAlertConfig(input: {
  alerts_enabled: boolean;
  alert_offline_threshold_minutes: number;
  alert_recipient_email: string;
}) {
  const parsed = alertConfigSchema.parse(input);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthorized");
  const { data: member } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member?.tenant_id) throw new Error("no tenant");

  const { error } = await supabase
    .from("tenants")
    .update(parsed)
    .eq("id", member.tenant_id);
  if (error) throw error;

  revalidatePath("/app/alerts");
}
