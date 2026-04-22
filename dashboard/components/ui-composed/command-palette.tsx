"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
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
  Settings,
  Plus,
  Upload,
} from "lucide-react";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function run(cmd: () => void) {
    cmd();
    setOpen(false);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => run(() => router.push("/app"))}>
            <Home className="mr-2 h-4 w-4" /> Home
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/app/screens"))}>
            <Monitor className="mr-2 h-4 w-4" /> {copy.screens}
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/app/locations"))}>
            <MapPin className="mr-2 h-4 w-4" /> {copy.locations}
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/app/media"))}>
            <ImageIcon className="mr-2 h-4 w-4" /> {copy.media}
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/app/playlists"))}>
            <ListMusic className="mr-2 h-4 w-4" /> {copy.playlists}
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/app/screen-groups"))}>
            <Users className="mr-2 h-4 w-4" /> {copy.screenGroups}
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/app/schedules"))}>
            <Clock className="mr-2 h-4 w-4" /> Scheduling
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/app/alerts"))}>
            <BellRing className="mr-2 h-4 w-4" /> Alerts
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/app/settings"))}>
            <Settings className="mr-2 h-4 w-4" /> Settings
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(() => router.push("/app/screens/add"))}>
            <Plus className="mr-2 h-4 w-4" /> {copy.addScreen}
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/app/media?upload=1"))}>
            <Upload className="mr-2 h-4 w-4" /> {copy.uploadMedia}
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/app/playlists?new=1"))}>
            <Plus className="mr-2 h-4 w-4" /> {copy.createPlaylist}
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/app/locations?new=1"))}>
            <Plus className="mr-2 h-4 w-4" /> {copy.addLocation}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
