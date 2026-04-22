import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { GroupMembersEditor } from "@/components/group-members-editor";
import { setGroupMembers, renameGroup, deleteGroup } from "@/lib/actions/device-groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default async function GroupDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: group }, { data: allDevices }, { data: members }] = await Promise.all([
    supabase.from("device_groups").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("devices").select("id, name, stores(name)").order("name"),
    supabase.from("device_group_members").select("device_id").eq("device_group_id", id),
  ]);
  if (!group) notFound();

  async function rename(fd: FormData) {
    "use server";
    await renameGroup(id, String(fd.get("name") ?? ""));
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
    <div className="space-y-6 max-w-2xl">
      <form action={rename} className="flex gap-2">
        <Input name="name" defaultValue={group.name} required />
        <Button type="submit">Rename</Button>
      </form>

      <section className="border rounded p-4 space-y-2">
        <h2 className="font-medium">Members</h2>
        <GroupMembersEditor allDevices={devices} currentMemberIds={memberIds} onSubmit={save} />
      </section>

      <form action={remove}>
        <Button type="submit" variant="destructive">Delete group</Button>
      </form>
    </div>
  );
}
