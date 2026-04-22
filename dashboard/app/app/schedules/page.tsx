import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// ISO day labels: index 1..7 (0 unused).
const DAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatDays(ds: number[]): string {
  const sorted = [...ds].sort((a, b) => a - b);
  // If it's Mon-Fri in one block, shorten.
  if (sorted.length === 5 && sorted.every((d, i) => d === i + 1)) return "Mon–Fri";
  if (sorted.length === 7) return "Every day";
  return sorted.map(d => DAY_LABELS[d]).join("/");
}

export default async function SchedulesPage() {
  const supabase = await createClient();
  const { data: rules } = await supabase.from("dayparting_rules")
    .select(`
      id, label, days_of_week, start_time, end_time, effective_at,
      playlists(name),
      target_device_id, devices(name),
      target_device_group_id, device_groups(name)
    `)
    .order("effective_at", { ascending: false });

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <h1 className="text-2xl font-semibold">Dayparting rules</h1>
        <Button asChild><Link href="/app/schedules/new">New rule</Link></Button>
      </div>
      <ul className="space-y-2">
        {(rules ?? []).map(r => (
          <li key={r.id} className="border rounded p-3">
            <Link href={`/app/schedules/${r.id}`} className="flex flex-col gap-1">
              <span className="font-medium">{r.label ?? "(unnamed)"}</span>
              <span className="text-sm text-muted-foreground">
                {formatDays(r.days_of_week)} {r.start_time}–{r.end_time} →
                {" "}<span className="italic">{(r.playlists as unknown as { name: string } | null)?.name ?? "(deleted)"}</span>
                {" · "}target:{" "}
                {r.target_device_id
                  ? (r.devices as unknown as { name: string } | null)?.name ?? "(deleted device)"
                  : (r.device_groups as unknown as { name: string } | null)?.name ?? "(deleted group)"}
              </span>
            </Link>
          </li>
        ))}
        {(!rules || rules.length === 0) && (
          <li className="text-muted-foreground">No rules yet.</li>
        )}
      </ul>
    </div>
  );
}
