// supabase/functions/pairing-claim/index.ts
import { serviceRoleClient } from "../_shared/supabase.ts";
import { mintDeviceAccessToken, generateRefreshToken, hashRefreshToken } from "../_shared/jwt.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const jwtSecret = Deno.env.get("DEVICE_JWT_SECRET");
  if (!jwtSecret) throw new Error("DEVICE_JWT_SECRET must be set");

  // Require Supabase auth header (user JWT)
  const userJwt = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!userJwt) return new Response("unauthenticated", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { code, store_id, name } = body;
  if (!code || !store_id || !name) return new Response("bad request", { status: 400 });

  // Use a user-scoped client so RLS enforces "this user actually owns the store":
  const userClient = (await import("https://esm.sh/@supabase/supabase-js@2.45.0"))
    .createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${userJwt}` } }, auth: { persistSession: false } },
    );

  // RLS-checked fetch of the store (proves the user has access to it):
  const { data: store, error: storeErr } = await userClient
    .from("stores").select("id, tenant_id").eq("id", store_id).single();
  if (storeErr || !store) return new Response("forbidden", { status: 403 });

  // Now use service role for pairing bookkeeping (the pairing row is not accessible by RLS):
  const svc = serviceRoleClient();

  const now = new Date().toISOString();

  // Atomic claim: UPDATE ... WHERE code=X AND claimed_at IS NULL AND expires_at > now.
  // Returns the row iff this request won the race; null otherwise. This collapses the
  // previous check-then-update TOCTOU into one SQL statement.
  const { data: claimed, error: claimErr } = await svc
    .from("pairing_requests")
    .update({ claimed_at: now })
    .eq("code", code)
    .is("claimed_at", null)
    .gt("expires_at", now)
    .select("code")
    .maybeSingle();
  if (claimErr) return new Response("db: " + claimErr.message, { status: 500 });
  if (!claimed) {
    // Disambiguate missing/claimed/expired for UX (this is the cold path):
    const { data: pr } = await svc
      .from("pairing_requests")
      .select("claimed_at, expires_at")
      .eq("code", code)
      .maybeSingle();
    if (!pr) return new Response("code not found", { status: 404 });
    if (pr.claimed_at) return new Response("already claimed", { status: 409 });
    return new Response("expired", { status: 410 });
  }

  // Create device:
  const refresh = generateRefreshToken();
  const refreshHash = await hashRefreshToken(refresh);

  const { data: device, error: devErr } = await svc.from("devices").insert({
    tenant_id: store.tenant_id,
    store_id: store.id,
    name: String(name).slice(0, 80),
    pairing_code: code,
    paired_at: now,
    refresh_token_hash: refreshHash,
    refresh_token_issued_at: now,
  }).select("id").single();
  if (devErr) {
    // Roll back the pairing_requests claim so the original TV can retry:
    await svc.from("pairing_requests")
      .update({ claimed_at: null })
      .eq("code", code)
      .is("claimed_device_id", null);
    return new Response("db: " + devErr.message, { status: 500 });
  }

  // Mint device access JWT BEFORE the final update so we can stash it in tv_pickup:
  const ttl = 3600;
  const accessToken = await mintDeviceAccessToken({
    deviceId: device.id,
    tenantId: store.tenant_id,
    ttlSeconds: ttl,
    secret: jwtSecret,
  });

  // Link claim → device AND stash the pickup bundle for the TV to drain via
  // pairing-status. The dashboard never sees the raw tokens.
  const { error: linkErr } = await svc.from("pairing_requests")
    .update({
      claimed_device_id: device.id,
      tv_pickup: { access_token: accessToken, refresh_token: refresh, expires_in: ttl },
    })
    .eq("code", code);
  if (linkErr) {
    // Best-effort cleanup: delete the orphan device and release the claim so the
    // user can retry. Failures here are logged; the caller will see a 500 either way.
    const { error: delErr } = await svc.from("devices").delete().eq("id", device.id);
    if (delErr) console.error("pairing-claim cleanup: devices delete failed", { device_id: device.id, error: delErr.message });
    const { error: relErr } = await svc.from("pairing_requests")
      .update({ claimed_at: null })
      .eq("code", code)
      .is("claimed_device_id", null);
    if (relErr) console.error("pairing-claim cleanup: claim release failed", { code, error: relErr.message });
    return new Response("db: " + linkErr.message, { status: 500 });
  }

  return Response.json({
    device_id: device.id,
    name: String(name).slice(0, 80),
  });
});
