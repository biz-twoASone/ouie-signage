import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { DaypartingRuleForm } from "@/components/dayparting-rule-form";
import { updateRule, deleteRule } from "@/lib/actions/dayparting";
import { Button } from "@/components/ui/button";

export default async function EditRulePage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: rule }, { data: devices }, { data: groups }, { data: playlists }] = await Promise.all([
    supabase.from("dayparting_rules").select("*").eq("id", id).maybeSingle(),
    supabase.from("devices").select("id, name").order("name"),
    supabase.from("device_groups").select("id, name").order("name"),
    supabase.from("playlists").select("id, name").order("name"),
  ]);
  if (!rule) notFound();

  async function save(input: Parameters<typeof updateRule>[1]) {
    "use server";
    return await updateRule(id, input);
  }
  async function remove() {
    "use server";
    await deleteRule(id);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Edit rule</h1>
      <DaypartingRuleForm
        initial={{
          name: rule.label ?? "",
          target_type: rule.target_device_id ? "device" : "device_group",
          target_id: rule.target_device_id ?? rule.target_device_group_id ?? "",
          days_of_week: rule.days_of_week,
          start_time: rule.start_time,
          end_time: rule.end_time,
          playlist_id: rule.playlist_id,
          effective_at: rule.effective_at,
        }}
        devices={devices ?? []}
        groups={groups ?? []}
        playlists={playlists ?? []}
        onSubmit={save}
        submitLabel="Save"
      />
      <form action={remove}>
        <Button type="submit" variant="destructive">Delete rule</Button>
      </form>
    </div>
  );
}
