import { createClient } from "@/lib/supabase/server";
import { PairDeviceForm } from "@/components/pair-device-form";
import { claimPairingCode } from "@/lib/actions/devices";
import Link from "next/link";

export default async function PairPage() {
  const supabase = await createClient();
  const { data: stores } = await supabase.from("stores").select("id, name").order("name");

  async function submit(input: { code: string; store_id: string; name?: string }) {
    "use server";
    return await claimPairingCode(input);
  }

  if (!stores || stores.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Pair a TV</h1>
        <p>You need to <Link href="/app/stores/new" className="underline">create a store</Link> first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Pair a TV</h1>
      <p className="text-muted-foreground">Enter the 6-character code shown on the TV screen.</p>
      <PairDeviceForm stores={stores} onSubmit={submit} />
    </div>
  );
}
