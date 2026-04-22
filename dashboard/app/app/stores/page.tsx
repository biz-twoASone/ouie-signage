import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function StoresPage() {
  const supabase = await createClient();
  const { data: stores } = await supabase
    .from("stores")
    .select("id, name, timezone, sync_window_start, sync_window_end")
    .order("name");

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <h1 className="text-2xl font-semibold">Stores</h1>
        <Button asChild><Link href="/app/stores/new">New store</Link></Button>
      </div>
      <ul className="space-y-2">
        {(stores ?? []).map((s) => (
          <li key={s.id} className="border rounded p-3">
            <Link href={`/app/stores/${s.id}`} className="flex justify-between">
              <span className="font-medium">{s.name}</span>
              <span className="text-sm text-muted-foreground">
                {s.timezone} · sync {s.sync_window_start.slice(0, 5)}–{s.sync_window_end.slice(0, 5)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
