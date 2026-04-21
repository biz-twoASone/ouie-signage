// supabase/functions/tests/sync_now.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";

const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

// sanitize* disabled: pairDevice() calls supabase-auth-js's signInWithPassword,
// which starts an _startAutoRefresh setInterval that Deno's leak sanitizer
// flags even with persistSession: false. Same precedent as heartbeat.test.ts.
Deno.test({
  name: "sync-now accepts request from tenant user",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    // Without fcm_token set on the device, the endpoint accepts the request
    // (202) but skips the FCM call — targetIds is empty and
    // Promise.allSettled([]) resolves immediately.
    const r = await fetch(`${FN}/devices-sync-now`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${creds.user_jwt}`,
      },
      body: JSON.stringify({ device_id: creds.device_id }),
    });
    assertEquals(r.status, 202);
    await r.body?.cancel();
  },
});
