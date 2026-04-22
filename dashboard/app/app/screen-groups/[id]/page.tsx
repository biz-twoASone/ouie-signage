import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { GroupMembersEditor } from "@/components/group-members-editor";
import { setGroupMembers, renameGroup, deleteGroup } from "@/lib/actions/device-groups";
import { PageHeader } from "@/components/ui-composed/page-header";
import { InlineEdit } from "@/components/ui-composed/inline-edit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteGroupButton } from "./delete-group-button";
import { copy } from "@/lib/copy";
import { UptimeRulesSection, type UptimeRule } from "@/components/uptime-rules-section";

export default async function GroupDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: group },
    { data: allDevices },
    { data: members },
    { data: uptimeRules },
  ] = await Promise.all([
    supabase.from("device_groups").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("devices").select("id, name, stores(name)").order("name"),
    supabase.from("device_group_members").select("device_id").eq("device_group_id", id),
    supabase.from("screen_uptime_rules")
      .select("id, days_of_week, start_time, end_time")
      .eq("target_device_group_id", id)
      .order("start_time"),
  ]);
  if (!group) notFound();

  async function rename(name: string) {
    "use server";
    await renameGroup(id, name);
  }
  async function remove() {
    "use server";
    await deleteGroup(id);
  }
  async function save(ids: string[]) {
    "use server";
    return await setGroupMembers(id, ids);
  }

  const memberIds = (members ?? []).map(m => m.device_id);
  const devices = (allDevices ?? []).map(d => ({
    id: d.id,
    name: d.name,
    store_name: (d.stores as unknown as { name: string } | null)?.name ?? "",
  }));

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title={
          <InlineEdit value={group.name} onSave={rename} data-testid="group-detail-name" />
        }
        description={`${memberIds.length} ${copy.screens.toLowerCase()} in this group.`}
      />

      <Card>
        <CardHeader><CardTitle className="text-base">Members</CardTitle></CardHeader>
        <CardContent>
          <GroupMembersEditor allDevices={devices} currentMemberIds={memberIds} onSubmit={save} />
        </CardContent>
      </Card>

      <UptimeRulesSection
        rules={(uptimeRules ?? []) as UptimeRule[]}
        target={{ device_group_id: id }}
      />

      <Card className="border-destructive/50">
        <CardHeader><CardTitle className="text-destructive text-base">Danger zone</CardTitle></CardHeader>
        <CardContent>
          <DeleteGroupButton onConfirm={remove} groupName={group.name} />
        </CardContent>
      </Card>
    </div>
  );
}
