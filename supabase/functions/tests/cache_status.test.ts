import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

// sanitize* disabled: pairDevice() calls supabase-auth-js's signInWithPassword,
// which starts an _startAutoRefresh setInterval that Deno's leak sanitizer flags
// even with persistSession: false. Same precedent as config.test.ts,
// refresh.test.ts, and heartbeat.test.ts.
Deno.test({
  name: "cache-status inserts events and returns 204",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const r = await fetch(`${FN}/devices-cache-status`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${creds.access_token}`,
      },
      body: JSON.stringify({
        events: [
          { media_id: null, state: "cached", message: "initial" },
        ],
      }),
    });
    assertEquals(r.status, 204);
    await r.body?.cancel();

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data } = await svc.from("cache_events").select("*").eq(
      "device_id",
      creds.device_id,
    );
    assert((data ?? []).length >= 1);
  },
});
