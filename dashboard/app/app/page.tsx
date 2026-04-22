import { createClient } from "@/lib/supabase/server";

export default async function AppHome() {
  const supabase = await createClient();
  const { data: devices } = await supabase
    .from("devices")
    .select("id, name, last_seen_at, store_id, stores(name)")
    .order("name");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Devices</h1>
      {(!devices || devices.length === 0) ? (
        <p className="text-muted-foreground">
          No devices yet. <a href="/app/devices/pair" className="underline">Pair a TV</a> to get started.
        </p>
      ) : (
        <ul className="space-y-2">
          {devices.map((d) => (
            <li key={d.id} className="border rounded p-3 flex justify-between">
              <span>{d.name}</span>
              <span className="text-muted-foreground text-sm">
                {(d.stores as unknown as { name: string } | null)?.name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
