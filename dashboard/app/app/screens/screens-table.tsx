"use client";

import { DataTable } from "@/components/ui-composed/data-table";
import { StatusPill } from "@/components/ui-composed/status-pill";
import { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Monitor } from "lucide-react";
import { copy } from "@/lib/copy";
import { Button } from "@/components/ui/button";

type Screen = {
  id: string;
  name: string;
  last_seen_at: string | null;
  stores: { name: string } | null;
};

const OFFLINE_MS = 5 * 60 * 1000;

const columns: ColumnDef<Screen>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link href={`/app/screens/${row.original.id}`} className="font-medium hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorFn: (r) => r.stores?.name ?? "—",
    id: "location",
    header: copy.location,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => {
      const ts = row.original.last_seen_at;
      const online = ts && Date.now() - new Date(ts).getTime() < OFFLINE_MS;
      return (
        <StatusPill
          variant={online ? "online" : "offline"}
          data-testid={`screens-row-${row.original.id}-status`}
        />
      );
    },
  },
  {
    accessorKey: "last_seen_at",
    header: "Last sync",
    cell: ({ row }) =>
      row.original.last_seen_at ? (
        <span className="text-muted-foreground font-mono text-xs">
          {new Date(row.original.last_seen_at).toLocaleString()}
        </span>
      ) : (
        <span className="text-muted-foreground">Never</span>
      ),
  },
];

export function ScreensTable({ data }: { data: Screen[] }) {
  return (
    <DataTable
      columns={columns}
      data={data}
      testIdPrefix="screens"
      rowId={(r) => r.id}
      emptyState={{
        icon: Monitor,
        title: `No ${copy.screens.toLowerCase()} yet`,
        description: `Pair your first TV to get started.`,
        primaryAction: (
          <Button asChild>
            <Link href="/app/screens/add">{copy.addScreen}</Link>
          </Button>
        ),
      }}
    />
  );
}
