import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createGroup } from "@/lib/actions/device-groups";

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
      <h1 className="text-2xl font-semibold">Device groups</h1>
      <form action={create} className="flex gap-2 max-w-md">
        <Input name="name" placeholder="e.g. Lunch-time TVs" required />
        <Button type="submit">Create group</Button>
      </form>
      <ul className="space-y-2">
        {(groups ?? []).map(g => (
          <li key={g.id} className="border rounded p-3">
            <Link href={`/app/screen-groups/${g.id}`} className="flex justify-between">
              <span className="font-medium">{g.name}</span>
              <span className="text-sm text-muted-foreground">
                {(g.device_group_members as { count: number }[])?.[0]?.count ?? 0} devices
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
