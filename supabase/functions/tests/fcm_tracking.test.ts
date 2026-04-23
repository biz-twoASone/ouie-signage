// supabase/functions/tests/fcm_tracking.test.ts
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

Deno.test({
  name: "heartbeat writes last_fcm_received_at when present in payload",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const receivedAt = "2026-04-23T12:00:00.000Z";
    const r = await fetch(`${FN}/devices-heartbeat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        app_version: "test",
        uptime_seconds: 10,
        last_fcm_received_at: receivedAt,
      }),
    });
    assertEquals(r.status, 204);
    await r.body?.cancel();

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data } = await svc.from("devices")
      .select("last_fcm_received_at")
      .eq("id", creds.device_id).single();
    // Postgres returns timestamptz in offset notation, not trailing "Z"
    assertEquals(data?.last_fcm_received_at, "2026-04-23T12:00:00+00:00");
  },
});

Deno.test({
  name: "devices-sync-now stamps last_sync_now_dispatched_at on the target device",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const before = await svc.from("devices")
      .select("last_sync_now_dispatched_at")
      .eq("id", creds.device_id).single();
    const beforeAt = before.data?.last_sync_now_dispatched_at;

    const r = await fetch(`${FN}/devices-sync-now`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.user_jwt}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ device_id: creds.device_id }),
    });
    assertEquals(r.status, 202);
    await r.body?.cancel();

    // Small delay for UPDATE to commit.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const after = await svc.from("devices")
      .select("last_sync_now_dispatched_at")
      .eq("id", creds.device_id).single();
    assertNotEquals(after.data?.last_sync_now_dispatched_at, beforeAt);
    assertNotEquals(after.data?.last_sync_now_dispatched_at, null);
  },
});
