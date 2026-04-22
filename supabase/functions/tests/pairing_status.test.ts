// supabase/functions/tests/pairing_status.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FN_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/pairing-status`;

Deno.test("pending code returns pending status", async () => {
  const rNew = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/pairing-request`, {
    method: "POST", headers: {"content-type":"application/json"}, body: "{}",
  });
  const { code } = await rNew.json();

  const res = await fetch(`${FN_URL}?code=${code}`);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "pending");
});

Deno.test("unknown code returns 404", async () => {
  const res = await fetch(`${FN_URL}?code=XXXXXX`);
  assertEquals(res.status, 404);
  await res.body?.cancel(); // consume body to satisfy Deno's resource sanitizer
});
