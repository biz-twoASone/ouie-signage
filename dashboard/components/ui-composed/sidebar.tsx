"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import {
  Home,
  Monitor,
  MapPin,
  Image as ImageIcon,
  ListMusic,
  Users,
  Clock,
  BellRing,
  Download,
  Settings,
} from "lucide-react";

const NAV = [
  { href: "/app", label: "Home", icon: Home, exact: true },
  { href: "/app/screens", label: copy.screens, icon: Monitor },
  { href: "/app/locations", label: copy.locations, icon: MapPin },
  { href: "/app/media", label: copy.media, icon: ImageIcon },
  { href: "/app/playlists", label: copy.playlists, icon: ListMusic },
  { href: "/app/screen-groups", label: copy.screenGroups, icon: Users },
  { href: "/app/schedules", label: "Scheduling", icon: Clock },
  { href: "/app/alerts", label: "Alerts", icon: BellRing },
  { href: "/app/app-releases", label: "App Releases", icon: Download },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="bg-sidebar flex h-full w-60 flex-col gap-0.5 border-r px-3 py-4">
      <div className="text-sidebar-foreground mb-3 px-2 text-sm font-semibold tracking-tight">
        {copy.productName}
      </div>
      {NAV.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            data-testid={`nav-${href.replaceAll("/", "-").replace(/^-+|-+$/g, "")}`}
            className={cn(
              "text-sidebar-foreground flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "hover:bg-sidebar-accent/50",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
