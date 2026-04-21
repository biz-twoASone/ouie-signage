// supabase/functions/tests/auth.test.ts
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractDeviceFromRequest } from "../_shared/auth.ts";
import { mintDeviceAccessToken } from "../_shared/jwt.ts";

const SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

Deno.test("extractDeviceFromRequest pulls claims from Bearer header", async () => {
  const token = await mintDeviceAccessToken({
    deviceId: "d1", tenantId: "t1", ttlSeconds: 60, secret: SECRET,
  });
  const req = new Request("http://localhost/", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const claims = await extractDeviceFromRequest(req, SECRET);
  assertEquals(claims.sub, "d1");
  assertEquals(claims.tenant_id, "t1");
});

Deno.test("extractDeviceFromRequest rejects missing header", async () => {
  const req = new Request("http://localhost/");
  await assertRejects(() => extractDeviceFromRequest(req, SECRET));
});
