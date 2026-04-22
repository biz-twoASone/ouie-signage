"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui-composed/confirm-dialog";
import { Trash2 } from "lucide-react";

export function DeletePlaylistButton({
  onConfirm,
  playlistName,
}: {
  onConfirm: () => Promise<void>;
  playlistName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="destructive"
        onClick={() => setOpen(true)}
        data-testid="playlist-detail-delete"
      >
        <Trash2 className="mr-2 h-4 w-4" /> Delete playlist
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${playlistName}?`}
        description="Any screens or schedules still assigned to this playlist will fall back to default behavior."
        confirmLabel="Delete"
        destructive
        onConfirm={onConfirm}
        data-testid="playlist-detail-delete-dialog"
      />
    </>
  );
}
