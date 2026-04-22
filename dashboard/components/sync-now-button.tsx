"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  onClick: () => Promise<{ ok?: boolean; error?: string }>;
  "data-testid"?: string;
};

export function SyncNowButton({ onClick, "data-testid": testid }: Props) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={pending}
        data-testid={testid}
        onClick={() => {
          setMsg(null);
          start(async () => {
            const r = await onClick();
            setMsg(r.error ? `Error: ${r.error}` : "Sync signal sent.");
          });
        }}
      >
        {pending ? "Sending…" : "Sync Now"}
      </Button>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </div>
  );
}
