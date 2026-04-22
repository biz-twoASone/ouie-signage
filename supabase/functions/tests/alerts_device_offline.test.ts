import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FN = `${SUPABASE_URL}/functions/v1`;

Deno.test({
  name: "alerts-device-offline: creates alert_events row for offline device",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();

    // Backdate the device's last_seen_at to 45 min ago so it counts as offline.
    const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const fortyFiveMinAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    const { error: updErr } = await svc.from("devices")
      .update({ last_seen_at: fortyFiveMinAgo })
      .eq("id", creds.device_id);
    assertEquals(updErr, null);

    // First call: should find the offline device and create an alert_events row.
    const r1 = await fetch(`${FN}/alerts-device-offline`, { method: "POST" });
    assertEquals(r1.status, 200);
    const body1 = await r1.json() as { tenants_alerted: number };
    assertEquals(body1.tenants_alerted, 1);

    // Verify alert_events row was inserted for this tenant.
    const { data: events } = await svc.from("alert_events")
      .select("id, kind, payload")
      .eq("tenant_id", creds.tenant_id)
      .eq("kind", "device_offline");
    assertEquals(events?.length, 1);

    // Second call within 1h: dedup should kick in, no new row.
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
