import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { StoreForm } from "@/components/store-form";
import { updateStore, deleteStore } from "@/lib/actions/stores";
import { Button } from "@/components/ui/button";

export default async function EditStorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: store } = await supabase
    .from("stores")
    .select("id, name, timezone, sync_window_start, sync_window_end")
    .eq("id", id)
    .maybeSingle();
  if (!store) notFound();

  async function save(input: Parameters<typeof updateStore>[1]) {
    "use server";
    return await updateStore(id, input);
  }

  async function remove() {
    "use server";
    await deleteStore(id);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Edit store</h1>
      <StoreForm
        initial={{
          name: store.name,
          timezone: store.timezone,
          sync_window_start: store.sync_window_start,
          sync_window_end: store.sync_window_end,
        }}
        onSubmit={save}
        submitLabel="Save"
      />
      <form action={remove}>
        <Button type="submit" variant="destructive">Delete store</Button>
      </form>
    </div>
  );
}
