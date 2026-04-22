"use client";

import { signOut } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { useTransition } from "react";

export function SignOutButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => start(() => signOut())}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
