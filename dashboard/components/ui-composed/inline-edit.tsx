"use client";

import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Check, X, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

export function InlineEdit({
  value,
  onSave,
  placeholder,
  className,
  "data-testid": testid,
}: {
  value: string;
  onSave: (next: string) => Promise<void> | void;
  placeholder?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  async function commit() {
    if (draft.trim() === value || draft.trim() === "") {
      setDraft(value);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        data-testid={testid}
        onClick={() => setEditing(true)}
        className={cn(
          "group inline-flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/50",
          className,
        )}
      >
        <span>{value}</span>
        <Pencil
          className="text-muted-foreground h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100"
          strokeWidth={1.5}
        />
      </button>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Input
        ref={inputRef}
        data-testid={testid}
        value={draft}
        placeholder={placeholder}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="h-8 max-w-sm"
      />
      <Button size="icon" variant="ghost" onClick={commit} disabled={saving}>
        <Check className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => {
          setDraft(value);
          setEditing(false);
        }}
        disabled={saving}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
