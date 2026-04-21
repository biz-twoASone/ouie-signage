"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  action: (formData: FormData) => Promise<{ ok?: boolean; error?: string }>;
};

export function LoginForm({ action }: Props) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const r = await action(fd);
          if (r.error) setMsg(`Error: ${r.error}`);
          else setMsg("Check your email for the magic link.");
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Send magic link"}
      </Button>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </form>
  );
}
