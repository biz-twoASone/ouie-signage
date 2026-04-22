// dashboard/lib/actions/screen-uptime.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const ruleSchema = z.object({
  days_of_week: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
});

type CreateInput = z.infer<typeof ruleSchema> & {
  target_device_id?: string;
  target_device_group_id?: string;
};

export async function createScreenUptimeRule(input: CreateInput) {
  const parsed = ruleSchema.parse({
    days_of_week: input.days_of_week,
    start_time: input.start_time,
    end_time: input.end_time,
  });
  if (!!input.target_device_id === !!input.target_device_group_id) {
    return { error: "Must target exactly one of device or group." };
  }
  const supabase = await createClient();
  const { data: member } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .maybeSingle();
  if (!member?.tenant_id) return { error: "No tenant context." };

  const { error } = await supabase.from("screen_uptime_rules").insert({
    tenant_id: member.tenant_id,
    target_device_id: input.target_device_id ?? null,
    target_device_group_id: input.target_device_group_id ?? null,
    ...parsed,
  });
  if (error) return { error: error.message };

  if (input.target_device_id) {
    revalidatePath(`/app/screens/${input.target_device_id}`);
  } else if (input.target_device_group_id) {
    revalidatePath(`/app/screen-groups/${input.target_device_group_id}`);
  }
  return { ok: true };
}

export async function deleteScreenUptimeRule(id: string) {
  const supabase = await createClient();
  // Fetch the rule to know what path to revalidate.
  const { data: rule } = await supabase
    .from("screen_uptime_rules")
    .select("target_device_id, target_device_group_id")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase.from("screen_uptime_rules").delete().eq("id", id);
  if (error) return { error: error.message };
  if (rule?.target_device_id) {
    revalidatePath(`/app/screens/${rule.target_device_id}`);
  } else if (rule?.target_device_group_id) {
    revalidatePath(`/app/screen-groups/${rule.target_device_group_id}`);
  }
  return { ok: true };
}
