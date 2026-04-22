"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Store = {
  id?: string;
  name: string;
  timezone: string;
  sync_window_start: string;
  sync_window_end: string;
};

type Props = {
  initial?: Store;
  onSubmit: (input: Omit<Store, "id">) => Promise<{ error?: string } | void>;
  submitLabel: string;
};

export function StoreForm({ initial, onSubmit, submitLabel }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-4 max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const input = {
          name: String(fd.get("name") ?? ""),
          timezone: String(fd.get("timezone") ?? ""),
          sync_window_start: String(fd.get("sync_window_start") ?? ""),
          sync_window_end: String(fd.get("sync_window_end") ?? ""),
        };
        start(async () => {
          const r = await onSubmit(input);
          if (r && "error" in r && r.error) setError(r.error);
        });
      }}
    >
      <Field label="Name" name="name" defaultValue={initial?.name} />
      <Field label="Timezone (IANA)" name="timezone" defaultValue={initial?.timezone ?? "Asia/Jakarta"} />
      <Field label="Sync window start" name="sync_window_start" type="time" defaultValue={initial?.sync_window_start ?? "02:00"} />
      <Field label="Sync window end" name="sync_window_end" type="time" defaultValue={initial?.sync_window_end ?? "05:00"} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

function Field({
  label, name, defaultValue, type = "text",
}: { label: string; name: string; defaultValue?: string; type?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={defaultValue} type={type} required />
    </div>
  );
}
