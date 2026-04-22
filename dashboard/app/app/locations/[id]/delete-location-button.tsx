"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui-composed/confirm-dialog";
import { Trash2 } from "lucide-react";

export function DeleteLocationButton({
  onConfirm,
  locationName,
}: {
  onConfirm: () => Promise<void>;
  locationName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="destructive"
        onClick={() => setOpen(true)}
        data-testid="location-detail-delete"
      >
        <Trash2 className="mr-2 h-4 w-4" /> Delete location
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${locationName}?`}
        description="Any screens in this location will be unassigned but not deleted."
        confirmLabel="Delete"
        destructive
        onConfirm={onConfirm}
        data-testid="location-detail-delete-dialog"
      />
    </>
  );
}
