import { StoreForm } from "@/components/store-form";
import { createStore } from "@/lib/actions/stores";
import { PageHeader } from "@/components/ui-composed/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { copy } from "@/lib/copy";

export default function NewLocationPage() {
  async function submit(input: Parameters<typeof createStore>[0]) {
    "use server";
    return await createStore(input);
  }
  return (
    <div className="max-w-xl space-y-6">
      <PageHeader
        title={`New ${copy.location.toLowerCase()}`}
        description="Add a physical site where screens will live."
      />
      <Card>
        <CardContent className="pt-6">
          <StoreForm onSubmit={submit} submitLabel={copy.addLocation} />
        </CardContent>
      </Card>
    </div>
  );
}
