"use client";

import { DataTable } from "@/components/ui-composed/data-table";
import { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { copy } from "@/lib/copy";
import { Button } from "@/components/ui/button";

type Location = {
  id: string;
  name: string;
  timezone: string;
  devices: { id: string }[] | null;
};

const columns: ColumnDef<Location>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link
        href={`/app/locations/${row.original.id}`}
        className="font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "timezone",
    header: "Timezone",
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono text-xs">
        {row.original.timezone}
      </span>
    ),
  },
  {
    id: "screen_count",
    header: `${copy.screens}`,
    accessorFn: (r) => r.devices?.length ?? 0,
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {row.original.devices?.length ?? 0}
      </span>
    ),
  },
];

export function LocationsTable({ data }: { data: Location[] }) {
  return (
    <DataTable
      columns={columns}
      data={data}
      testIdPrefix="locations"
      rowId={(r) => r.id}
      emptyState={{
        icon: MapPin,
        title: `No ${copy.locations.toLowerCase()} yet`,
        description: "Create a location to group your screens by physical site.",
        primaryAction: (
          <Button asChild>
            <Link href="/app/locations/new">{copy.addLocation}</Link>
          </Button>
        ),
      }}
    />
  );
}
