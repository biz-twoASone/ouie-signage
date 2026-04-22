import Link from "next/link";

const items = [
  { href: "/app", label: "Home" },
  { href: "/app/locations", label: "Stores" },
  { href: "/app/screens", label: "Devices" },
  { href: "/app/screen-groups", label: "Groups" },
  { href: "/app/media", label: "Media" },
  { href: "/app/playlists", label: "Playlists" },
  { href: "/app/schedules", label: "Schedules" },
];

export function Nav() {
  return (
    <nav className="flex gap-4 text-sm">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="text-muted-foreground hover:text-foreground">
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
