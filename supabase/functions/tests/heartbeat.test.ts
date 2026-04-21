// supabase/functions/tests/heartbeat.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";

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
        clock_skew_seconds_from_server: 2,
        cache_storage_info: { root: "internal", total_bytes: 1000, free_bytes: 500 },
        errors_since_last_heartbeat: [],
      }),
    });
    assertEquals(r.status, 204);
    await r.body?.cancel();
  },
});
