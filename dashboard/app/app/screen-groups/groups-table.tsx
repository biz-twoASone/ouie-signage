"use client";

import { DataTable } from "@/components/ui-composed/data-table";
import { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Users } from "lucide-react";
import { copy } from "@/lib/copy";

type Group = {
  id: string;
  name: string;
  device_group_members: { count: number }[] | null;
};

const columns: ColumnDef<Group>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link
        href={`/app/screen-groups/${row.original.id}`}
        className="font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: "members",
    header: "Screens",
    accessorFn: (r) => r.device_group_members?.[0]?.count ?? 0,
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {row.original.device_group_members?.[0]?.count ?? 0}
      </span>
    ),
  },
];

export function GroupsTable({ data }: { data: Group[] }) {
  return (
    <DataTable
      columns={columns}
      data={data}
      testIdPrefix="screen-groups"
      rowId={(r) => r.id}
      emptyState={{
        icon: Users,
        title: `No ${copy.screenGroups.toLowerCase()} yet`,
        description: "Group your screens to manage assignments in bulk.",
      }}
    />
  );
}
