import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import type { Crumb } from "./breadcrumbs";

type Tenant = { id: string; name: string };

export function AppShell({
  children,
  userEmail,
  currentTenant,
  tenants,
  breadcrumbs,
}: {
  children: React.ReactNode;
  userEmail: string;
  currentTenant: Tenant;
  tenants: Tenant[];
  breadcrumbs?: Crumb[];
}) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          userEmail={userEmail}
          currentTenant={currentTenant}
          tenants={tenants}
          breadcrumbs={breadcrumbs}
        />
        <main className="bg-background flex-1 overflow-y-auto p-6">{children}</main>
      </div>
      <CommandPalette />
    </div>
  );
}
