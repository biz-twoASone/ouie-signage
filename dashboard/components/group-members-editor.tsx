"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

type Device = { id: string; name: string; store_name: string };
type Props = {
  allDevices: Device[];
  currentMemberIds: string[];
  onSubmit: (ids: string[]) => Promise<{ error?: string } | void>;
};

export function GroupMembersEditor({ allDevices, currentMemberIds, onSubmit }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(currentMemberIds));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  function save() {
    setMsg(null);
    start(async () => {
      const r = await onSubmit(Array.from(selected));
      setMsg(r && "error" in r && r.error ? `Error: ${r.error}` : "Saved.");
    });
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {allDevices.map(d => (
          <li key={d.id}>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(d.id)}
                onChange={() => toggle(d.id)}
              />
              <span>{d.name}</span>
              <span className="text-sm text-muted-foreground">· {d.store_name}</span>
            </label>
          </li>
        ))}
        {allDevices.length === 0 && <li className="text-sm text-muted-foreground">No devices yet.</li>}
      </ul>
      <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save members"}</Button>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </div>
  );
}
