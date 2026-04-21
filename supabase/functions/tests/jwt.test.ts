// supabase/functions/tests/jwt.test.ts
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mintDeviceAccessToken, verifyDeviceAccessToken } from "../_shared/jwt.ts";

const SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

Deno.test("mint then verify round-trips device access token", async () => {
  const token = await mintDeviceAccessToken({
    deviceId: "11111111-1111-1111-1111-111111111111",
    tenantId: "22222222-2222-2222-2222-222222222222",
    ttlSeconds: 60,
    secret: SECRET,
  });
  const claims = await verifyDeviceAccessToken(token, SECRET);
  assertEquals(claims.sub, "11111111-1111-1111-1111-111111111111");
  assertEquals(claims.tenant_id, "22222222-2222-2222-2222-222222222222");
  assertEquals(claims.role, "device");
});

Deno.test("verify rejects tampered token", async () => {
  const token = await mintDeviceAccessToken({
    deviceId: "11111111-1111-1111-1111-111111111111",
    tenantId: "22222222-2222-2222-2222-222222222222",
    ttlSeconds: 60,
    secret: SECRET,
  });
  const tampered = token.slice(0, -4) + "AAAA";
  await assertRejects(() => verifyDeviceAccessToken(tampered, SECRET));
});

Deno.test("verify rejects expired token", async () => {
  const token = await mintDeviceAccessToken({
    deviceId: "11111111-1111-1111-1111-111111111111",
    tenantId: "22222222-2222-2222-2222-222222222222",
    ttlSeconds: -1, // already expired
    secret: SECRET,
  });
  await assertRejects(() => verifyDeviceAccessToken(token, SECRET));
});
