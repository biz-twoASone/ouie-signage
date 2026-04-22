// dashboard/components/uptime-rules-section.tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { createScreenUptimeRule, deleteScreenUptimeRule } from "@/lib/actions/screen-uptime";

export type UptimeRule = {
  id: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
};

const DAYS: { id: number; short: string }[] = [
  { id: 1, short: "Mon" }, { id: 2, short: "Tue" }, { id: 3, short: "Wed" },
  { id: 4, short: "Thu" }, { id: 5, short: "Fri" }, { id: 6, short: "Sat" },
  { id: 7, short: "Sun" },
];

function formatDays(ds: number[]): string {
  const sorted = [...ds].sort((a, b) => a - b);
  if (sorted.length === 5 && sorted.every((d, i) => d === i + 1)) return "Mon–Fri";
  if (sorted.length === 7) return "Every day";
  return sorted.map(d => DAYS[d - 1].short).join(", ");
}

export function UptimeRulesSection({
  rules,
  target,
}: {
  rules: UptimeRule[];
  target: { device_id: string } | { device_group_id: string };
}) {
  const [days, setDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]));
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("18:00");
  const [pending, start_] = useTransition();

  function toggleDay(d: number) {
    const next = new Set(days);
    if (next.has(d)) next.delete(d); else next.add(d);
    setDays(next);
  }

  async function add() {
    start_(async () => {
      const input = {
        days_of_week: Array.from(days).sort((a, b) => a - b),
        start_time: start,
        end_time: end,
        ...("device_id" in target
          ? { target_device_id: target.device_id }
          : { target_device_group_id: target.device_group_id }),
      };
      const r = await createScreenUptimeRule(input);
      if (r && "error" in r && r.error) toast.error(r.error);
      else toast.success("Uptime rule added.");
    });
  }

  async function remove(id: string) {
    start_(async () => {
      const r = await deleteScreenUptimeRule(id);
      if (r && "error" in r && r.error) toast.error(r.error);
      else toast.success("Rule removed.");
    });
  }

  return (
    <Card data-testid="uptime-rules-section">
      <CardHeader>
        <CardTitle className="text-base">Uptime schedule</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-xs">
          When a rule matches the current time (in the location&apos;s timezone), offline alerts will fire. With no rules, this screen stays silent.
        </p>

        {rules.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">No rules yet. Add one below.</p>
        ) : (
          <ul className="space-y-2">
            {rules.map((r) => (
              <li
                key={r.id}
                data-testid={`uptime-rule-${r.id}`}
                className="bg-muted/30 flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{formatDays(r.days_of_week)}</span>
                  <span className="text-muted-foreground font-mono"> {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}</span>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(r.id)}
                  disabled={pending}
                  aria-label="Remove rule"
                  data-testid={`uptime-rule-${r.id}-delete`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-3 border-t pt-4">
          <div className="space-y-1.5">
            <Label>Days</Label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => (
                <label
                  key={d.id}
                  className={`border rounded px-3 py-1 text-xs cursor-pointer ${days.has(d.id) ? "bg-primary text-primary-foreground" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={days.has(d.id)}
                    onChange={() => toggleDay(d.id)}
                  />
                  {d.short}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="uptime-start">Start time</Label>
              <Input
                id="uptime-start"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="uptime-end">End time</Label>
              <Input
                id="uptime-end"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
          <Button
            onClick={add}
            disabled={pending || days.size === 0}
            data-testid="uptime-rule-add"
          >
            <Plus className="mr-2 h-4 w-4" /> Add rule
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
