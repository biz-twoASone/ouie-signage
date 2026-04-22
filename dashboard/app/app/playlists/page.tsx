import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createPlaylist } from "@/lib/actions/playlists";
import { Input } from "@/components/ui/input";

export default async function PlaylistsPage() {
  const supabase = await createClient();
  const { data: playlists } = await supabase
    .from("playlists").select("id, name").order("name");

  async function create(fd: FormData) {
    "use server";
    await createPlaylist(String(fd.get("name") ?? ""));
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Playlists</h1>

      <form action={create} className="flex gap-2 max-w-md">
        <Input name="name" placeholder="New playlist name" required />
        <Button type="submit">Create</Button>
      </form>

      <ul className="space-y-2">
        {(playlists ?? []).map(p => (
          <li key={p.id} className="border rounded p-3">
            <Link href={`/app/playlists/${p.id}`} className="font-medium">{p.name}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
