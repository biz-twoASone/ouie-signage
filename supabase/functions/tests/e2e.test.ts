// supabase/functions/tests/e2e.test.ts
//
// End-to-end happy-path: pair → heartbeat → config (v1) → seed a fallback
// playlist → config (v2 with new ETag) → refresh (new access token).
//
// This exercises the full Plan 1 surface from a freshly-paired device's
// perspective and confirms the ETag changes when the device's effective
// config changes (via fallback_playlist_id flip).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// sanitize* disabled: pairDevice() calls supabase-auth-js's signInWithPassword,
// which starts an _startAutoRefresh setInterval that Deno's leak sanitizer
// flags even with persistSession: false. Same precedent as heartbeat.test.ts
// and sync_now.test.ts.
Deno.test({
  name: "E2E: pair → heartbeat → config → refresh → config (new ETag)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();

    // --- Heartbeat (204 No Content) ---
    const hb = await fetch(`${FN}/devices-heartbeat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        app_version: "0.1.0",
        cache_storage_info: { root: "internal" },
        errors_since_last_heartbeat: [],
      }),
    });
    assertEquals(hb.status, 204);
    await hb.body?.cancel();

    // --- Config v1 (baseline ETag before any config mutation) ---
    const c1 = await fetch(`${FN}/devices-config`, {
      headers: { Authorization: `Bearer ${creds.access_token}` },
    });
    assertEquals(c1.status, 200);
    const etag1 = c1.headers.get("ETag");
    assert(etag1, "config v1 must return an ETag");
    await c1.body?.cancel();

    // --- Mutate server state: attach a fallback playlist to the device ---
    const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const { data: pl, error: plErr } = await svc.from("playlists")
      .insert({ tenant_id: creds.tenant_id, name: "fallback" })
      .select()
      .single();
    if (plErr) throw new Error(`insert playlists failed: ${plErr.message}`);
    if (!pl) throw new Error("insert playlists returned no row");

    const { error: updErr } = await svc.from("devices")
      .update({ fallback_playlist_id: pl.id })
      .eq("id", creds.device_id);
    if (updErr) throw new Error(`update devices failed: ${updErr.message}`);

    // --- Config v2: echo v1's ETag via If-None-Match; server must NOT 304
    //     because the payload now includes a different fallback_playlist_id,
    //     so the hash (and thus ETag) must differ. ---
    const c2 = await fetch(`${FN}/devices-config`, {
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        "If-None-Match": etag1,
      },
    });
    assertEquals(c2.status, 200);
    const etag2 = c2.headers.get("ETag");
    assert(etag2, "config v2 must return an ETag");
    assert(etag1 !== etag2, "ETag must change when fallback playlist changes");
    await c2.body?.cancel();

    // --- Refresh: rotates tokens. The refresh_token is cryptographically
    //     random, so it's deterministically different. The access_token is a
    //     JWT whose payload is (deviceId, tenantId, role, iat, exp); with
    //     iat at 1-second resolution and a stable payload otherwise, two
    //     mints within the same wall-clock second are bitwise-identical
    //     (HMAC is deterministic) — so we can't assert access_token
    //     inequality reliably. Instead, assert refresh_token rotation
    //     (the meaningful security-critical property) and shape-check
    //     access_token. Same pattern as refresh.test.ts. ---
    const rr = await fetch(`${FN}/devices-refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: creds.refresh_token }),
    });
    assertEquals(rr.status, 200);
    const newCreds = await rr.json() as {
      access_token?: unknown;
      refresh_token?: unknown;
    };
    assert(
      typeof newCreds.access_token === "string" && newCreds.access_token.length > 0,
      "refresh response must include a non-empty access_token string",
    );
    assert(
      typeof newCreds.refresh_token === "string" && newCreds.refresh_token.length > 0,
      "refresh response must include a non-empty refresh_token string",
    );
    assert(
      newCreds.refresh_token !== creds.refresh_token,
      "refresh token must rotate",
    );
  },
});
