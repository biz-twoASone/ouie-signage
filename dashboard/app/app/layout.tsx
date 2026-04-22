import { getCurrentTenant } from "@/lib/actions/tenant";
import { redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { UserMenu } from "@/components/user-menu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/login");

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-semibold">{tenant.tenant_name}</span>
          <Nav />
        </div>
        <UserMenu email={tenant.email ?? ""} />
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
