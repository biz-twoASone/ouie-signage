import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createGroup } from "@/lib/actions/device-groups";
import { PageHeader } from "@/components/ui-composed/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { GroupsTable } from "./groups-table";
import { copy } from "@/lib/copy";

type Group = {
  id: string;
  name: string;
  device_group_members: { count: number }[] | null;
};

export default async function GroupsPage() {
  const supabase = await createClient();
  const { data: groups } = await supabase
    .from("device_groups")
    .select("id, name, device_group_members(count)")
    .order("name");

  async function create(fd: FormData) {
    "use server";
    await createGroup(String(fd.get("name") ?? ""));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.screenGroups}
        description="Group screens to manage playlist assignments in bulk."
      />

      <Card>
        <CardContent className="pt-6">
          <form action={create} className="flex max-w-md gap-2" data-testid="create-group-form">
            <Input name="name" placeholder="e.g. Lunch-time TVs" required />
            <Button type="submit">{copy.addScreenGroup}</Button>
          </form>
        </CardContent>
      </Card>

      <GroupsTable data={(groups ?? []) as unknown as Group[]} />
    </div>
  );
}
