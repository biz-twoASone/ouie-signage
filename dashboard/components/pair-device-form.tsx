"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Store = { id: string; name: string };
type Props = {
  stores: Store[];
  onSubmit: (input: { code: string; store_id: string; name?: string }) => Promise<{ error?: string } | void>;
};

export function PairDeviceForm({ stores, onSubmit }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-4 max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const input = {
          code: String(fd.get("code") ?? "").toUpperCase(),
          store_id: String(fd.get("store_id") ?? ""),
          name: String(fd.get("name") ?? ""),
        };
        start(async () => {
          const r = await onSubmit(input);
          if (r && "error" in r && r.error) setError(r.error);
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="code">Pairing code</Label>
        <Input
          id="code"
          name="code"
          placeholder="ABC123"
          maxLength={6}
          required
          pattern="[A-Za-z0-9]{6}"
          className="font-mono text-xl uppercase tracking-widest"
          data-testid="pairing-code-input"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="store_id">Location</Label>
        <select
          id="store_id"
          name="store_id"
          className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
          required
          data-testid="pair-location-select"
        >
          <option value="">Select a location…</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="name">Screen name</Label>
        <Input id="name" name="name" placeholder="TV - Front counter" data-testid="pair-name-input" />
      </div>
      <Button type="submit" disabled={pending} data-testid="pair-submit">
        {pending ? "Pairing…" : "Pair screen"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
