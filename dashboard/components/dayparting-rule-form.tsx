"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ISO day numbering: 1=Monday through 7=Sunday, matches schema CHECK.
const DAYS: { id: number; short: string }[] = [
  { id: 1, short: "Mon" }, { id: 2, short: "Tue" }, { id: 3, short: "Wed" },
  { id: 4, short: "Thu" }, { id: 5, short: "Fri" }, { id: 6, short: "Sat" },
  { id: 7, short: "Sun" },
];

export type RuleFormValue = {
  name: string;
  target_type: "device" | "device_group";
  target_id: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  playlist_id: string;
  effective_at: string;
};

type Props = {
  initial?: Partial<RuleFormValue>;
  devices: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  playlists: { id: string; name: string }[];
  onSubmit: (input: RuleFormValue) => Promise<{ error?: string } | void>;
  submitLabel: string;
};

export function DaypartingRuleForm({ initial, devices, groups, playlists, onSubmit, submitLabel }: Props) {
  const [targetType, setTargetType] = useState<"device" | "device_group">(initial?.target_type ?? "device");
  const [days, setDays] = useState<Set<number>>(new Set(initial?.days_of_week ?? [1, 2, 3, 4, 5]));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggleDay(d: number) {
    const next = new Set(days);
    if (next.has(d)) next.delete(d); else next.add(d);
    setDays(next);
  }

  return (
    <form
      className="space-y-4 max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const input: RuleFormValue = {
          name: String(fd.get("name") ?? ""),
          target_type: targetType,
          target_id: String(fd.get("target_id") ?? ""),
          days_of_week: Array.from(days).sort((a, b) => a - b),
          start_time: String(fd.get("start_time") ?? ""),
          end_time: String(fd.get("end_time") ?? ""),
          playlist_id: String(fd.get("playlist_id") ?? ""),
          effective_at: String(fd.get("effective_at") ?? new Date().toISOString()),
        };
        start(async () => {
          const r = await onSubmit(input);
          if (r && "error" in r && r.error) setError(r.error);
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="name">Rule name</Label>
        <Input id="name" name="name" defaultValue={initial?.name} placeholder="e.g. Lunch menu weekdays" required />
      </div>

      <div className="space-y-1.5">
        <Label>Target</Label>
        <div className="flex gap-2 items-center">
          <label className="flex gap-1 items-center">
            <input type="radio" name="target_type" value="device"
              checked={targetType === "device"}
              onChange={() => setTargetType("device")} />
            Single device
          </label>
          <label className="flex gap-1 items-center">
            <input type="radio" name="target_type" value="device_group"
              checked={targetType === "device_group"}
              onChange={() => setTargetType("device_group")} />
            Device group
          </label>
        </div>
        <select name="target_id" defaultValue={initial?.target_id ?? ""}
          className="border rounded h-10 w-full px-3" required>
          <option value="">Select a {targetType === "device" ? "device" : "group"}…</option>
          {(targetType === "device" ? devices : groups).map(t =>
            <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label>Days of week (device-local)</Label>
        <div className="flex flex-wrap gap-2">
          {DAYS.map(d => (
            <label key={d.id} className={`border rounded px-3 py-1 cursor-pointer ${days.has(d.id) ? "bg-primary text-primary-foreground" : ""}`}>
              <input type="checkbox" className="sr-only" checked={days.has(d.id)} onChange={() => toggleDay(d.id)} />
              {d.short}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="start_time">Start time</Label>
          <Input type="time" name="start_time" defaultValue={initial?.start_time ?? "11:00"} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="end_time">End time</Label>
          <Input type="time" name="end_time" defaultValue={initial?.end_time ?? "14:00"} required />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="playlist_id">Playlist</Label>
        <select name="playlist_id" defaultValue={initial?.playlist_id ?? ""} className="border rounded h-10 w-full px-3" required>
          <option value="">Select a playlist…</option>
          {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="effective_at">Effective from</Label>
        <Input type="datetime-local" name="effective_at"
          defaultValue={(initial?.effective_at ?? new Date().toISOString()).slice(0, 16)} required />
        <p className="text-xs text-muted-foreground">Rule takes effect at this timestamp. Use now for immediate.</p>
      </div>

      <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
