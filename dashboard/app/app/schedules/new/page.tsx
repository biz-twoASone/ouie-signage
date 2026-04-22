import { createClient } from "@/lib/supabase/server";
import { DaypartingRuleForm } from "@/components/dayparting-rule-form";
import { createRule } from "@/lib/actions/dayparting";

export default async function NewRulePage() {
  const supabase = await createClient();
  const [{ data: devices }, { data: groups }, { data: playlists }] = await Promise.all([
    supabase.from("devices").select("id, name").order("name"),
    supabase.from("device_groups").select("id, name").order("name"),
    supabase.from("playlists").select("id, name").order("name"),
  ]);

  async function submit(input: Parameters<typeof createRule>[0]) {
    "use server";
    return await createRule(input);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New dayparting rule</h1>
      <DaypartingRuleForm
        devices={devices ?? []}
        groups={groups ?? []}
        playlists={playlists ?? []}
        onSubmit={submit}
        submitLabel="Create rule"
      />
    </div>
  );
}
