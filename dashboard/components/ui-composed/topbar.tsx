"use client";

import { Breadcrumbs, type Crumb } from "./breadcrumbs";
import { ThemeToggle } from "./theme-toggle";
import { TenantSwitcher } from "./tenant-switcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/actions/auth";
import { User, LogOut, Command } from "lucide-react";

type Tenant = { id: string; name: string };

export function Topbar({
  userEmail,
  currentTenant,
  tenants,
  breadcrumbs,
}: {
  userEmail: string;
  currentTenant: Tenant;
  tenants: Tenant[];
  breadcrumbs?: Crumb[];
}) {
  return (
    <header className="border-border bg-background flex h-14 items-center justify-between border-b px-4">
      <div className="flex items-center gap-4">
        <TenantSwitcher currentTenant={currentTenant} tenants={tenants} />
        {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="text-muted-foreground gap-2 font-mono">
          <Command className="h-3 w-3" /> K
        </Button>
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" data-testid="user-menu-trigger">
              <User className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              {userEmail}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <form action={signOut}>
              <DropdownMenuItem asChild>
                <button type="submit" className="w-full">
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
