import { StoreForm } from "@/components/store-form";
import { createStore } from "@/lib/actions/stores";

export default function NewStorePage() {
  async function submit(input: Parameters<typeof createStore>[0]) {
    "use server";
    return await createStore(input);
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New store</h1>
      <StoreForm onSubmit={submit} submitLabel="Create store" />
    </div>
  );
}
