"use client";

import { DataTable } from "@/components/ui-composed/data-table";
import { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

const DAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatDays(ds: number[]): string {
  const sorted = [...ds].sort((a, b) => a - b);
  if (sorted.length === 5 && sorted.every((d, i) => d === i + 1)) return "Mon–Fri";
  if (sorted.length === 7) return "Every day";
  return sorted.map((d) => DAY_LABELS[d]).join("/");
}

type Rule = {
  id: string;
  label: string | null;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  effective_at: string;
  playlists: { name: string } | null;
  target_device_id: string | null;
  devices: { name: string } | null;
  target_device_group_id: string | null;
  device_groups: { name: string } | null;
};

const columns: ColumnDef<Rule>[] = [
  {
    accessorKey: "label",
    header: "Label",
    cell: ({ row }) => (
      <Link
        href={`/app/schedules/${row.original.id}`}
        className="font-medium hover:underline"
      >
        {row.original.label ?? "(unnamed)"}
      </Link>
    ),
  },
  {
    id: "days",
    header: "Days",
    accessorFn: (r) => formatDays(r.days_of_week),
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {formatDays(row.original.days_of_week)}
      </span>
    ),
  },
  {
    id: "window",
    header: "Window",
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono text-xs">
        {row.original.start_time.slice(0, 5)}–{row.original.end_time.slice(0, 5)}
      </span>
    ),
  },
  {
    id: "playlist",
    header: "Playlist",
    accessorFn: (r) => r.playlists?.name ?? "(deleted)",
    cell: ({ row }) => (
      <span className="italic">
        {row.original.playlists?.name ?? "(deleted)"}
      </span>
    ),
  },
  {
    id: "target",
    header: "Target",
    cell: ({ row }) => {
      const r = row.original;
      const name = r.target_device_id
        ? r.devices?.name ?? "(deleted screen)"
        : r.device_groups?.name ?? "(deleted group)";
      return <span className="text-muted-foreground text-sm">{name}</span>;
    },
  },
];

export function SchedulesTable({ data }: { data: Rule[] }) {
  return (
    <DataTable
      columns={columns}
      data={data}
      testIdPrefix="dayparting-rules"
      rowId={(r) => r.id}
      emptyState={{
        icon: Clock,
        title: "No scheduling rules yet",
        description: "Create a rule to override the fallback playlist at specific times.",
        primaryAction: (
          <Button asChild>
            <Link href="/app/schedules/new">New rule</Link>
          </Button>
        ),
      }}
    />
  );
}
