"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  initialName: string;
  onSubmit: (name: string) => Promise<{ error?: string } | void>;
};

export function RenameDeviceForm({ initialName, onSubmit }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-2 max-w-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const name = String(new FormData(e.currentTarget).get("name") ?? "");
        start(async () => {
          const r = await onSubmit(name);
          if (r && "error" in r && r.error) setError(r.error);
        });
      }}
    >
      <Label htmlFor="name">Device name</Label>
      <div className="flex gap-2">
        <Input id="name" name="name" defaultValue={initialName} required />
        <Button type="submit" disabled={pending}>{pending ? "…" : "Save"}</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
