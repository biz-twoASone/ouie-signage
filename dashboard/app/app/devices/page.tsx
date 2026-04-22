import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DeviceStatusBadge } from "@/components/device-status-badge";

export default async function DevicesPage() {
  const supabase = await createClient();
  const { data: devices } = await supabase
    .from("devices")
    .select("id, name, last_seen_at, store_id, stores(name)")
    .order("name");

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <h1 className="text-2xl font-semibold">Devices</h1>
        <Button asChild><Link href="/app/devices/pair">Pair a TV</Link></Button>
      </div>
      <ul className="space-y-2">
        {(devices ?? []).map((d) => (
          <li key={d.id} className="border rounded p-3">
            <Link href={`/app/devices/${d.id}`} className="flex justify-between items-center">
              <span>
                <span className="font-medium">{d.name}</span>
                {" · "}
                <span className="text-muted-foreground text-sm">
                  {(d.stores as unknown as { name: string } | null)?.name}
                </span>
              </span>
              <DeviceStatusBadge last_seen_at={d.last_seen_at} />
            </Link>
          </li>
        ))}
        {(!devices || devices.length === 0) && (
          <li className="text-muted-foreground">
            No devices. <Link href="/app/devices/pair" className="underline">Pair a TV</Link> to start.
          </li>
        )}
      </ul>
    </div>
  );
}
