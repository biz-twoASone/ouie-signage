import { createClient } from "@/lib/supabase/server";
import { PairDeviceForm } from "@/components/pair-device-form";
import { claimPairingCode } from "@/lib/actions/devices";
import Link from "next/link";
import { PageHeader } from "@/components/ui-composed/page-header";
import { EmptyState } from "@/components/ui-composed/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, Monitor } from "lucide-react";
import { copy } from "@/lib/copy";

export default async function AddScreenPage() {
  const supabase = await createClient();
  const { data: stores } = await supabase.from("stores").select("id, name").order("name");

  async function submit(input: { code: string; store_id: string; name?: string }) {
    "use server";
    return await claimPairingCode(input);
  }

  if (!stores || stores.length === 0) {
    return (
      <div className="max-w-xl space-y-6">
        <PageHeader title={copy.addScreen} description="Pair a TV to your workspace." />
        <EmptyState
          icon={MapPin}
          title={`No ${copy.locations.toLowerCase()} yet`}
          description={`You need at least one ${copy.location.toLowerCase()} before pairing a screen.`}
          primaryAction={
            <Button asChild>
              <Link href="/app/locations/new">{copy.addLocation}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-6">
      <PageHeader
        title={copy.addScreen}
        description="Enter the 6-character code shown on the TV's Ouie Signage app."
      />

      <ol className="text-muted-foreground flex gap-4 text-xs">
        <li className="flex items-center gap-2">
          <span className="bg-primary text-primary-foreground flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold">1</span>
          Open the app on the TV
        </li>
        <li className="flex items-center gap-2">
          <span className="bg-primary text-primary-foreground flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold">2</span>
          Enter code below
        </li>
        <li className="flex items-center gap-2">
          <span className="bg-muted text-muted-foreground flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold">3</span>
          <Monitor className="h-3 w-3" /> Done
        </li>
      </ol>

      <Card>
        <CardContent className="pt-6">
          <PairDeviceForm stores={stores} onSubmit={submit} />
        </CardContent>
      </Card>
    </div>
  );
}
