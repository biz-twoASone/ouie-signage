// supabase/functions/tests/heartbeat.test.ts
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

// sanitize* disabled: pairDevice() calls supabase-auth-js's signInWithPassword,
// which starts an _startAutoRefresh setInterval that Deno's leak sanitizer flags
// even with persistSession: false. Same precedent as config.test.ts and
// refresh.test.ts.
Deno.test({
  name: "heartbeat updates last_seen_at and cache_storage_info",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const r = await fetch(`${FN}/devices-heartbeat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        app_version: "0.1.0",
        uptime_seconds: 100,
        current_playlist_id: null,
        last_config_version_applied: "v1",
        clock_skew_seconds_from_server: 2,
        cache_storage_info: { root: "internal", total_bytes: 1000, free_bytes: 500 },
        errors_since_last_heartbeat: [],
        fcm_token: "fake-fcm-token-abc123",
      }),
    });
    assertEquals(r.status, 204);
    await r.body?.cancel();

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: dev } = await svc.from("devices")
      .select("last_seen_at, cache_storage_info")
      .eq("id", creds.device_id).single();
    assertEquals(dev?.cache_storage_info, { root: "internal", total_bytes: 1000, free_bytes: 500 });
    assertNotEquals(dev?.last_seen_at, null);

    const { data: device } = await svc.from("devices")
      .select("current_app_version, last_config_version_applied, clock_skew_seconds_from_server, fcm_token")
      .eq("id", creds.device_id).single();
    assertEquals(device?.current_app_version, "0.1.0");
    assertEquals(device?.last_config_version_applied, "v1");
    assertEquals(device?.clock_skew_seconds_from_server, 2);
    assertEquals(device?.fcm_token, "fake-fcm-token-abc123");
  },
});
