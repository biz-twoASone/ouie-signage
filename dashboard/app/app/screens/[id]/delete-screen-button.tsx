"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui-composed/confirm-dialog";
import { Trash2 } from "lucide-react";

export function DeleteScreenButton({
  onConfirm,
  screenName,
}: {
  onConfirm: () => Promise<void>;
  screenName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="destructive"
        onClick={() => setOpen(true)}
        data-testid="screen-detail-delete"
      >
        <Trash2 className="mr-2 h-4 w-4" /> Delete screen
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${screenName}?`}
        description="This unpairs the screen and removes its configuration. The physical device will show the pairing screen on next boot."
        confirmLabel="Delete"
        destructive
        onConfirm={onConfirm}
        data-testid="screen-detail-delete-dialog"
      />
    </>
  );
}
