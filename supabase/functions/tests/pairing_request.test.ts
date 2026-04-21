// supabase/functions/tests/pairing_request.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FN_URL = Deno.env.get("FN_URL") ?? "http://127.0.0.1:54321/functions/v1/pairing-request";

Deno.test("POST pairing-request returns a 6-char code", async () => {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_proposed_name: "Test TV" }),
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(/^[A-HJ-NP-Z2-9]{6}$/.test(body.code), `code format: got ${body.code}`);
  assert(body.expires_at, "expires_at present");
});
