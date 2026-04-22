import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui-composed/page-header";
import { Button } from "@/components/ui/button";
import { ScreensTable } from "./screens-table";
import Link from "next/link";
import { copy } from "@/lib/copy";
import { Plus } from "lucide-react";

type Screen = {
  id: string;
  name: string;
  last_seen_at: string | null;
  stores: { name: string } | null;
};

export default async function ScreensListPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("devices")
    .select("id, name, last_seen_at, stores(name)")
    .order("name");
  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.screens}
        description="Every TV paired to your workspace."
        primaryAction={
          <Button asChild data-testid="screens-add-button">
            <Link href="/app/screens/add">
              <Plus className="mr-2 h-4 w-4" /> {copy.addScreen}
            </Link>
          </Button>
        }
      />
      <ScreensTable data={(data ?? []) as unknown as Screen[]} />
    </div>
  );
}
