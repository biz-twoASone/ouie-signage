"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui-composed/confirm-dialog";
import { Trash2 } from "lucide-react";

export function DeleteGroupButton({
  onConfirm,
  groupName,
}: {
  onConfirm: () => Promise<void>;
  groupName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="destructive"
        onClick={() => setOpen(true)}
        data-testid="group-detail-delete"
      >
        <Trash2 className="mr-2 h-4 w-4" /> Delete group
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${groupName}?`}
        description="Member screens are unaffected; they just lose this grouping."
        confirmLabel="Delete"
        destructive
        onConfirm={onConfirm}
        data-testid="group-detail-delete-dialog"
      />
    </>
  );
}
