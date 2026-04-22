"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Building2, Check, ChevronsUpDown } from "lucide-react";

type Tenant = { id: string; name: string };

export function TenantSwitcher({
  currentTenant,
  tenants,
}: {
  currentTenant: Tenant;
  tenants: Tenant[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 justify-between gap-2 px-2"
          data-testid="tenant-switcher"
        >
          <span className="flex items-center gap-2 truncate">
            <Building2 className="text-muted-foreground h-4 w-4 shrink-0" />
            <span className="truncate text-sm font-medium">{currentTenant.name}</span>
          </span>
          <ChevronsUpDown className="text-muted-foreground h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-muted-foreground text-xs">
          Workspaces
        </DropdownMenuLabel>
        {tenants.map((t) => (
          <DropdownMenuItem key={t.id} disabled={t.id !== currentTenant.id}>
            <span className="flex-1 truncate">{t.name}</span>
            {t.id === currentTenant.id && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="text-muted-foreground text-xs">
          Multi-workspace support coming soon
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
