// supabase/functions/tests/refresh.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";

const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

// sanitize* disabled: pairDevice() calls supabase-auth-js's signInWithPassword,
// which starts an _startAutoRefresh setInterval that Deno's leak sanitizer flags
// even with persistSession: false. Same precedent as pairing_claim.test.ts.
Deno.test({
  name: "refresh rotates tokens",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const r = await fetch(`${FN}/devices-refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: creds.refresh_token }),
    });
    assertEquals(r.status, 200);
    const body = await r.json();
    assert(body.access_token);
    assert(body.refresh_token);
    assert(body.refresh_token !== creds.refresh_token, "refresh token must rotate");
  },
});

Deno.test({
  name: "old refresh token becomes invalid after rotation",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    await fetch(`${FN}/devices-refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: creds.refresh_token }),
    }).then((r) => r.json());

    // Re-use the OLD refresh token — should fail (theft detection)
    const second = await fetch(`${FN}/devices-refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: creds.refresh_token }),
    });
    assertEquals(second.status, 401);
    await second.body?.cancel();
  },
});

Deno.test({
  name: "concurrent refresh with same old token — only one wins",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    // Fire two refreshes in parallel with the SAME old refresh token.
    // Without the CAS guard, both could return 200 with different new tokens.
    const [a, b] = await Promise.all([
      fetch(`${FN}/devices-refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: creds.refresh_token }),
      }),
      fetch(`${FN}/devices-refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: creds.refresh_token }),
      }),
    ]);
    const statuses = [a.status, b.status].sort();
    await a.body?.cancel();
    await b.body?.cancel();
    assertEquals(statuses, [200, 401], "exactly one request must win the rotation");
  },
});
