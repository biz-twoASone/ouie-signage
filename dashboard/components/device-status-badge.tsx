import { Badge } from "@/components/ui/badge";

export function DeviceStatusBadge({ last_seen_at }: { last_seen_at: string | null }) {
  if (!last_seen_at) return <Badge variant="secondary">Never paired</Badge>;
  const ageSec = (Date.now() - new Date(last_seen_at).getTime()) / 1000;
  if (ageSec < 120) return <Badge className="bg-green-600">Online</Badge>;
  if (ageSec < 600) return <Badge className="bg-amber-500">Slow</Badge>;
  return <Badge variant="destructive">Offline</Badge>;
}
