// supabase/functions/pairing-claim/index.ts
import { serviceRoleClient } from "../_shared/supabase.ts";
import { mintDeviceAccessToken, generateRefreshToken, hashRefreshToken } from "../_shared/jwt.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

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

  const { data: pr, error: prErr } = await svc
    .from("pairing_requests")
    .select("code, expires_at, claimed_at")
    .eq("code", code)
    .maybeSingle();
  if (prErr) return new Response("db: " + prErr.message, { status: 500 });
  if (!pr) return new Response("code not found", { status: 404 });
  if (pr.claimed_at) return new Response("already claimed", { status: 409 });
  if (new Date(pr.expires_at) < new Date()) return new Response("expired", { status: 410 });

  // Create device:
  const refresh = generateRefreshToken();
  const refreshHash = await hashRefreshToken(refresh);
  const now = new Date().toISOString();

  const { data: device, error: devErr } = await svc.from("devices").insert({
    tenant_id: store.tenant_id,
    store_id: store.id,
    name: String(name).slice(0, 80),
    pairing_code: code,
    paired_at: now,
    refresh_token_hash: refreshHash,
    refresh_token_issued_at: now,
  }).select("id").single();
  if (devErr) return new Response("db: " + devErr.message, { status: 500 });

  await svc.from("pairing_requests").update({
    claimed_at: now,
    claimed_device_id: device.id,
  }).eq("code", code);

  const ttl = 3600;
  const accessToken = await mintDeviceAccessToken({
    deviceId: device.id,
    tenantId: store.tenant_id,
    ttlSeconds: ttl,
    secret: Deno.env.get("DEVICE_JWT_SECRET")!,
  });

  return Response.json({
    device_id: device.id,
    access_token: accessToken,
    refresh_token: refresh,
    expires_in: ttl,
  });
});
