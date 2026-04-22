import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui-composed/page-header";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { LocationsTable } from "./locations-table";
import { copy } from "@/lib/copy";
import { Plus } from "lucide-react";

type Location = {
  id: string;
  name: string;
  timezone: string;
  devices: { id: string }[] | null;
};

export default async function LocationsListPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stores")
    .select("id, name, timezone, devices(id)")
    .order("name");
  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.locations}
        description="Physical sites where your screens live."
        primaryAction={
          <Button asChild data-testid="locations-add-button">
            <Link href="/app/locations/new">
              <Plus className="mr-2 h-4 w-4" /> {copy.addLocation}
            </Link>
          </Button>
        }
      />
      <LocationsTable data={(data ?? []) as unknown as Location[]} />
    </div>
  );
}
