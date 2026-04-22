import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/ui-composed/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityItem } from "@/components/ui-composed/activity-item";
import { EmptyState } from "@/components/ui-composed/empty-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-composed/page-header";
import { Monitor, MonitorOff, Clock, Plus, Upload, ListMusic, MapPin } from "lucide-react";
import Link from "next/link";
import { copy } from "@/lib/copy";
import { formatDistanceToNowStrict } from "./format-relative";

const OFFLINE_MS = 5 * 60 * 1000;

export default async function DashboardHome() {
  const supabase = await createClient();

  const [{ data: screens }, { data: playlists }] = await Promise.all([
    supabase.from("devices").select("id, name, last_seen_at, store_id"),
    supabase.from("playlists").select("id, name, playlist_items(id)"),
  ]);

  const now = Date.now();
  const online = (screens ?? []).filter(
    (s) => s.last_seen_at && now - new Date(s.last_seen_at).getTime() < OFFLINE_MS
  );
  const offline = (screens ?? []).filter(
    (s) => !s.last_seen_at || now - new Date(s.last_seen_at).getTime() >= OFFLINE_MS
  );
  const lastSync = (screens ?? [])
    .map((s) => s.last_seen_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  const emptyScreens = !screens || screens.length === 0;
  if (emptyScreens) {
    return (
      <div className="space-y-6">
        <PageHeader title={`Welcome to ${copy.productName}`} />
        <EmptyState
          icon={Monitor}
          title={`Add your first ${copy.screen.toLowerCase()}`}
          description="Pair a TV to start showing content. You'll get a 6-digit code, enter it on the TV's Ouie Signage app."
          primaryAction={
            <Button asChild data-testid="home-add-first-screen">
              <Link href="/app/screens/add">
                <Plus className="mr-2 h-4 w-4" /> {copy.addScreen}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const needsAttention = [
    ...offline.map((s) => ({
      kind: "offline" as const,
      id: s.id,
      name: s.name,
      ts: s.last_seen_at,
      href: `/app/screens/${s.id}`,
    })),
    ...(playlists ?? [])
      .filter((p) => !p.playlist_items || p.playlist_items.length === 0)
      .map((p) => ({
        kind: "empty-playlist" as const,
        id: p.id,
        name: p.name,
        ts: null,
        href: `/app/playlists/${p.id}`,
      })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Home"
        description={`Overview of your ${copy.screens.toLowerCase()} and recent activity.`}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label={`${copy.screens} online`}
          value={online.length}
          subtext={`of ${screens!.length} total`}
          icon={Monitor}
          tone={online.length === screens!.length ? "success" : "default"}
          data-testid="home-stat-online"
        />
        <StatCard
          label={`${copy.screens} offline`}
          value={offline.length}
          subtext={offline.length === 0 ? "All good" : "Check below"}
          icon={MonitorOff}
          tone={offline.length > 0 ? "destructive" : "default"}
          data-testid="home-stat-offline"
        />
        <StatCard
          label="Last sync"
          value={lastSync ? formatDistanceToNowStrict(new Date(lastSync)) : "—"}
          subtext="Most recent heartbeat"
          icon={Clock}
          data-testid="home-stat-last-sync"
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card data-testid="home-needs-attention">
          <CardHeader>
            <CardTitle className="text-base">Needs attention</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 p-3 pt-0">
            {needsAttention.length === 0 ? (
              <p className="text-muted-foreground px-3 py-2 text-sm">Nothing urgent.</p>
            ) : (
              needsAttention.map((n) => (
                <ActivityItem
                  key={`${n.kind}-${n.id}`}
                  icon={n.kind === "offline" ? MonitorOff : ListMusic}
                  timestamp={n.ts ? formatDistanceToNowStrict(new Date(n.ts)) : "now"}
                  href={n.href}
                  tone={n.kind === "offline" ? "destructive" : "warning"}
                >
                  {n.kind === "offline" ? (
                    <>
                      <span className="font-medium">{n.name}</span> offline
                    </>
                  ) : (
                    <>
                      Playlist <span className="font-medium">{n.name}</span> has no items
                    </>
                  )}
                </ActivityItem>
              ))
            )}
          </CardContent>
        </Card>

        <Card data-testid="home-quick-actions">
          <CardHeader>
            <CardTitle className="text-base">Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 pt-0">
            <Button asChild variant="outline" className="h-auto flex-col gap-1 py-3">
              <Link href="/app/screens/add">
                <Plus className="h-4 w-4" />
                <span className="text-xs">{copy.addScreen}</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto flex-col gap-1 py-3">
              <Link href="/app/media?upload=1">
                <Upload className="h-4 w-4" />
                <span className="text-xs">{copy.uploadMedia}</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto flex-col gap-1 py-3">
              <Link href="/app/playlists?new=1">
                <ListMusic className="h-4 w-4" />
                <span className="text-xs">{copy.createPlaylist}</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto flex-col gap-1 py-3">
              <Link href="/app/locations?new=1">
                <MapPin className="h-4 w-4" />
                <span className="text-xs">{copy.addLocation}</span>
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
