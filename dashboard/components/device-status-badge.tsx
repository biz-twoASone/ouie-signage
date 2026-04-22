import { Badge } from "@/components/ui/badge";

type Props = {
  last_seen_at: string | null;
  clock_skew_seconds?: number | null;
};

export function DeviceStatusBadge({ last_seen_at, clock_skew_seconds }: Props) {
  if (!last_seen_at) return <Badge variant="secondary">Never paired</Badge>;
  const ageSec = (Date.now() - new Date(last_seen_at).getTime()) / 1000;
  const skewBad = Math.abs(clock_skew_seconds ?? 0) > 120;
  if (ageSec < 120) {
    return skewBad
      ? <Badge className="bg-amber-500">Online (clock skew)</Badge>
      : <Badge className="bg-green-600">Online</Badge>;
  }
  if (ageSec < 600) return <Badge className="bg-amber-500">Slow</Badge>;
  return <Badge variant="destructive">Offline</Badge>;
}
