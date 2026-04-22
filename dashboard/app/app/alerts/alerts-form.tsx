"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateAlertConfig } from "@/lib/actions/alerts";
import { toast } from "sonner";

export function AlertsForm({
  initial,
  ownerEmail,
}: {
  initial: {
    alerts_enabled: boolean;
    alert_offline_threshold_minutes: number;
    alert_recipient_email: string;
  };
  ownerEmail: string;
}) {
  const [enabled, setEnabled] = useState(initial.alerts_enabled);
  const [threshold, setThreshold] = useState(initial.alert_offline_threshold_minutes);
  const [recipient, setRecipient] = useState(initial.alert_recipient_email);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateAlertConfig({
        alerts_enabled: enabled,
        alert_offline_threshold_minutes: threshold,
        alert_recipient_email: recipient,
      });
      toast.success("Alert settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" data-testid="alerts-form">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="alerts-enabled">Email me when screens go offline</Label>
          <p className="text-muted-foreground text-xs">
            Digest sent at most once per hour per alert type.
          </p>
        </div>
        <Switch
          id="alerts-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
          data-testid="alerts-enabled-switch"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="threshold">Offline threshold (minutes)</Label>
        <Input
          id="threshold"
          type="number"
          min={5}
          max={1440}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          disabled={!enabled}
          data-testid="alerts-threshold-input"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="recipient">Send to</Label>
        <Input
          id="recipient"
          type="email"
          placeholder={ownerEmail}
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          disabled={!enabled}
          data-testid="alerts-email-input"
        />
        <p className="text-muted-foreground text-xs">
          Leave blank to send to {ownerEmail} (workspace owner).
        </p>
      </div>

      <Button type="submit" disabled={saving} data-testid="alerts-save-button">
        {saving ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}
