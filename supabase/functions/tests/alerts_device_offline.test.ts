import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FN = `${SUPABASE_URL}/functions/v1`;

Deno.test({
  name: "alerts-device-offline: creates alert_events row for offline device (with always-on rule)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();

    const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

    // Seed an always-on uptime rule so the alert isn't suppressed by the new default.
    const { error: ruleErr } = await svc.from("screen_uptime_rules").insert({
      tenant_id: creds.tenant_id,
      target_device_id: creds.device_id,
      days_of_week: [1, 2, 3, 4, 5, 6, 7],
      start_time: "00:00",
      end_time: "23:59",
    });
    assertEquals(ruleErr, null);

    const fortyFiveMinAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    const { error: updErr } = await svc.from("devices")
      .update({ last_seen_at: fortyFiveMinAgo })
      .eq("id", creds.device_id);
    assertEquals(updErr, null);

    const r1 = await fetch(`${FN}/alerts-device-offline`, { method: "POST" });
    assertEquals(r1.status, 200);
    const body1 = await r1.json() as { tenants_alerted: number };
    assertEquals(body1.tenants_alerted, 1);

    const { data: events } = await svc.from("alert_events")
      .select("id, kind, payload")
      .eq("tenant_id", creds.tenant_id)
      .eq("kind", "device_offline");
    assertEquals(events?.length, 1);

    const r2 = await fetch(`${FN}/alerts-device-offline`, { method: "POST" });
    assertEquals(r2.status, 200);
    const body2 = await r2.json() as { tenants_alerted: number };
    assertEquals(body2.tenants_alerted, 0);

    const { data: events2 } = await svc.from("alert_events")
      .select("id")
      .eq("tenant_id", creds.tenant_id)
      .eq("kind", "device_offline");
    assertEquals(events2?.length, 1, "dedup: no new alert_events row");
  },
});

Deno.test({
  name: "alerts-device-offline: tenant with alerts_enabled=false is skipped",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

    // Opt this tenant OUT of alerts.
    await svc.from("tenants").update({ alerts_enabled: false }).eq("id", creds.tenant_id);

    // Backdate the device so it WOULD be offline if alerts were enabled.
    const fortyFiveMinAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    await svc.from("devices").update({ last_seen_at: fortyFiveMinAgo }).eq("id", creds.device_id);

    const r = await fetch(`${FN}/alerts-device-offline`, { method: "POST" });
    assertEquals(r.status, 200);
    await r.body?.cancel();

    // No alert_events row for the opted-out tenant.
    const { data: events } = await svc.from("alert_events")
      .select("id")
      .eq("tenant_id", creds.tenant_id)
      .eq("kind", "device_offline");
    assertEquals(events?.length, 0, "opted-out tenant must not receive an alert_events row");
  },
});

Deno.test({
  name: "alerts-device-offline: per-tenant threshold is respected",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

    // Set a 120-minute threshold for this tenant.
    await svc.from("tenants")
      .update({ alert_offline_threshold_minutes: 120 })
      .eq("id", creds.tenant_id);

    // Backdate device 45 min — below the 120-min threshold.
    const fortyFiveMinAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    await svc.from("devices").update({ last_seen_at: fortyFiveMinAgo }).eq("id", creds.device_id);

    const r = await fetch(`${FN}/alerts-device-offline`, { method: "POST" });
    assertEquals(r.status, 200);
    await r.body?.cancel();

    // No alert: device was offline for less than threshold.
    const { data: events } = await svc.from("alert_events")
      .select("id")
      .eq("tenant_id", creds.tenant_id)
      .eq("kind", "device_offline");
    assertEquals(events?.length, 0, "device below per-tenant threshold must not trigger");
  },
});

Deno.test({
  name: "alerts-device-offline: alert_recipient_email override is recorded in payload",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

    // Seed an always-on uptime rule so the alert isn't suppressed by the new default.
    await svc.from("screen_uptime_rules").insert({
      tenant_id: creds.tenant_id,
      target_device_id: creds.device_id,
      days_of_week: [1, 2, 3, 4, 5, 6, 7],
      start_time: "00:00",
      end_time: "23:59",
    });

    const override = `ops-${Date.now()}@test.local`;
    await svc.from("tenants")
      .update({ alert_recipient_email: override })
      .eq("id", creds.tenant_id);

    // Backdate device to trigger the alert.
    const fortyFiveMinAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    await svc.from("devices").update({ last_seen_at: fortyFiveMinAgo }).eq("id", creds.device_id);

    const r = await fetch(`${FN}/alerts-device-offline`, { method: "POST" });
    assertEquals(r.status, 200);
    await r.body?.cancel();

    const { data: events } = await svc.from("alert_events")
      .select("payload")
      .eq("tenant_id", creds.tenant_id)
      .eq("kind", "device_offline");
    assertEquals(events?.length, 1);
    const payload = events![0].payload as { recipient?: string };
    assertEquals(payload.recipient, override, "payload.recipient must reflect override");
  },
});

Deno.test({
  name: "alerts-device-offline: skips online devices",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    // Device's last_seen_at is null or fresh (pairDevice leaves last_seen_at null
    // for never-paired devices; schema uses last_seen_at nullable).
    // The function's filter is `.lt("last_seen_at", cutoff)` which excludes nulls
    // — so an un-heartbeated device doesn't trigger an alert.

    const r = await fetch(`${FN}/alerts-device-offline`, { method: "POST" });
    assertEquals(r.status, 200);
    const body = await r.json() as { tenants_alerted: number };
    // Should be 0 since our device's last_seen_at is null.
    // NOTE: other tests may have left offline devices — accept 0 or more, but
    // require that OUR tenant didn't trigger a new alert.
    const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const { data: events } = await svc.from("alert_events")
      .select("id")
      .eq("tenant_id", creds.tenant_id)
      .eq("kind", "device_offline");
    assertEquals(events?.length, 0, "no alert for tenant with null last_seen_at device");
  },
});

Deno.test({
  name: "alerts-device-offline: device with NO uptime rules is silent (new default)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

    // No rules inserted. Backdate to make the device offline.
    const fortyFiveMinAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    await svc.from("devices").update({ last_seen_at: fortyFiveMinAgo }).eq("id", creds.device_id);

    const r = await fetch(`${FN}/alerts-device-offline`, { method: "POST" });
    assertEquals(r.status, 200);
    await r.body?.cancel();

    const { data: events } = await svc.from("alert_events")
      .select("id")
      .eq("tenant_id", creds.tenant_id)
      .eq("kind", "device_offline");
    assertEquals(events?.length, 0, "no uptime rule = silent, even if offline");
  },
});

Deno.test({
  name: "alerts-device-offline: device-level rule that does not cover now → no alert",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

    // Rule covers only Sunday 03:00-03:05 — virtually never matches "now".
    await svc.from("screen_uptime_rules").insert({
      tenant_id: creds.tenant_id,
      target_device_id: creds.device_id,
      days_of_week: [7],
      start_time: "03:00",
      end_time: "03:05",
    });

    const fortyFiveMinAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    await svc.from("devices").update({ last_seen_at: fortyFiveMinAgo }).eq("id", creds.device_id);

    const r = await fetch(`${FN}/alerts-device-offline`, { method: "POST" });
    assertEquals(r.status, 200);
    await r.body?.cancel();

    const { data: events } = await svc.from("alert_events")
      .select("id")
      .eq("tenant_id", creds.tenant_id);
    assertEquals(events?.length, 0, "current time outside rule window = silent");
  },
});

Deno.test({
  name: "alerts-device-offline: group-level rule applies when device has no device-level rule",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

    // Create a group, add device as member, attach a 24/7 uptime rule to the group.
    const { data: group } = await svc.from("device_groups")
      .insert({ tenant_id: creds.tenant_id, name: "E2E group" })
      .select().single();
    await svc.from("device_group_members").insert({
      device_group_id: group!.id, device_id: creds.device_id,
    });
    await svc.from("screen_uptime_rules").insert({
      tenant_id: creds.tenant_id,
      target_device_group_id: group!.id,
      days_of_week: [1, 2, 3, 4, 5, 6, 7],
      start_time: "00:00",
      end_time: "23:59",
    });

    const fortyFiveMinAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    await svc.from("devices").update({ last_seen_at: fortyFiveMinAgo }).eq("id", creds.device_id);

    const r = await fetch(`${FN}/alerts-device-offline`, { method: "POST" });
    assertEquals(r.status, 200);
    await r.body?.cancel();

    const { data: events } = await svc.from("alert_events")
      .select("id")
      .eq("tenant_id", creds.tenant_id);
    assertEquals(events?.length, 1, "group rule covers device when no device-level rule exists");
  },
});

Deno.test({
  name: "alerts-device-offline: device-level rule overrides group-level rule",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

    // Group says always-on; but device-level rule is Sunday-only (doesn't cover now).
    // Expected: device-level wins → silent.
    const { data: group } = await svc.from("device_groups")
      .insert({ tenant_id: creds.tenant_id, name: "E2E group 2" })
      .select().single();
    await svc.from("device_group_members").insert({
      device_group_id: group!.id, device_id: creds.device_id,
    });
    await svc.from("screen_uptime_rules").insert({
      tenant_id: creds.tenant_id,
      target_device_group_id: group!.id,
      days_of_week: [1, 2, 3, 4, 5, 6, 7],
      start_time: "00:00",
      end_time: "23:59",
    });
    await svc.from("screen_uptime_rules").insert({
      tenant_id: creds.tenant_id,
      target_device_id: creds.device_id,
      days_of_week: [7],
      start_time: "03:00",
      end_time: "03:05",
    });

    const fortyFiveMinAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    await svc.from("devices").update({ last_seen_at: fortyFiveMinAgo }).eq("id", creds.device_id);

    const r = await fetch(`${FN}/alerts-device-offline`, { method: "POST" });
    assertEquals(r.status, 200);
    await r.body?.cancel();

    const { data: events } = await svc.from("alert_events")
      .select("id")
      .eq("tenant_id", creds.tenant_id);
    assertEquals(events?.length, 0, "device-level rule (narrow) wins over group-level (always-on)");
  },
});
