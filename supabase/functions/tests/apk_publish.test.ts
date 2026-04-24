// supabase/functions/tests/apk_publish.test.ts
// Plan 5 Phase 1 Task 3 — TDD for apk-publish: monotonic version_code guard
// + sha256 validation + tenant pointer write. Uses the established pairDevice
// helper for user/tenant bootstrap.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { pairDevice } from "./_helpers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FN = `${SUPABASE_URL}/functions/v1`;

Deno.test({
  name: "apk-publish: happy path inserts pointer",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const r = await fetch(`${FN}/apk-publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.user_jwt}`, "content-type": "application/json" },
      body: JSON.stringify({
        version_code: 8,
        version_name: "0.5.0-p5",
        r2_path: `tenants/${creds.tenant_id}/apks/8.apk`,
        sha256: "a".repeat(64),
      }),
    });
    assertEquals(r.status, 200);
    await r.body?.cancel();

    const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const { data } = await svc.from("tenants").select(
      "latest_apk_version_code, latest_apk_version_name, latest_apk_r2_path, latest_apk_sha256",
    ).eq("id", creds.tenant_id).single();
    assertEquals(data?.latest_apk_version_code, 8);
    assertEquals(data?.latest_apk_version_name, "0.5.0-p5");
    assertEquals(data?.latest_apk_r2_path, `tenants/${creds.tenant_id}/apks/8.apk`);
    assertEquals(data?.latest_apk_sha256, "a".repeat(64));
  },
});

Deno.test({
  name: "apk-publish: rejects non-monotonic version_code",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    // First publish: succeeds.
    const r1 = await fetch(`${FN}/apk-publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.user_jwt}`, "content-type": "application/json" },
      body: JSON.stringify({
        version_code: 10,
        version_name: "0.5.0",
        r2_path: `tenants/${creds.tenant_id}/apks/10.apk`,
        sha256: "b".repeat(64),
      }),
    });
    assertEquals(r1.status, 200);
    await r1.body?.cancel();

    // Same version_code: rejected with 409.
    const r2 = await fetch(`${FN}/apk-publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.user_jwt}`, "content-type": "application/json" },
      body: JSON.stringify({
        version_code: 10,
        version_name: "0.5.1",
        r2_path: `tenants/${creds.tenant_id}/apks/10.apk`,
        sha256: "c".repeat(64),
      }),
    });
    assertEquals(r2.status, 409);
    await r2.body?.cancel();

    // Lower version_code: also rejected.
    const r3 = await fetch(`${FN}/apk-publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.user_jwt}`, "content-type": "application/json" },
      body: JSON.stringify({
        version_code: 9,
        version_name: "0.4.9",
        r2_path: `tenants/${creds.tenant_id}/apks/9.apk`,
        sha256: "d".repeat(64),
      }),
    });
    assertEquals(r3.status, 409);
    await r3.body?.cancel();

    // Confirm pointer still reflects the first successful publish.
    const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const { data } = await svc.from("tenants").select("latest_apk_version_code").eq(
      "id", creds.tenant_id,
    ).single();
    assertEquals(data?.latest_apk_version_code, 10);
  },
});

Deno.test({
  name: "apk-publish: rejects malformed sha256",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const r = await fetch(`${FN}/apk-publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.user_jwt}`, "content-type": "application/json" },
      body: JSON.stringify({
        version_code: 1,
        version_name: "0.0.1",
        r2_path: `tenants/${creds.tenant_id}/apks/1.apk`,
        sha256: "not-hex",
      }),
    });
    assertEquals(r.status, 400);
    await r.body?.cancel();
  },
});
