// supabase/functions/tests/config.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";

const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

// sanitize* disabled: pairDevice() calls supabase-auth-js's signInWithPassword,
// which starts an _startAutoRefresh setInterval that Deno's leak sanitizer flags
// even with persistSession: false. Same precedent as pairing_claim.test.ts and
// refresh.test.ts.
Deno.test({
  name: "devices-config returns 200 with version header",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const r = await fetch(`${FN}/devices-config`, {
      headers: { Authorization: `Bearer ${creds.access_token}` },
    });
    assertEquals(r.status, 200);
    const etag = r.headers.get("ETag");
    // Edge-runtime / Kong may auto-weaken strong ETags to `W/"..."` when
    // compression is negotiated, so tolerate either form.
    assert(etag?.replace(/^W\//, "").startsWith("\"sha256:"));
    const body = await r.json();
    assert(body.version);
    assert(body.device.id);
    assertEquals(typeof body.rules, "object"); // array
  },
});

Deno.test({
  name: "If-None-Match matching current version returns 304",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const r1 = await fetch(`${FN}/devices-config`, {
      headers: { Authorization: `Bearer ${creds.access_token}` },
    });
    const etag = r1.headers.get("ETag")!;
    await r1.body?.cancel();
    const r2 = await fetch(`${FN}/devices-config`, {
      headers: { Authorization: `Bearer ${creds.access_token}`, "If-None-Match": etag },
    });
    assertEquals(r2.status, 304);
    await r2.body?.cancel();
  },
});
