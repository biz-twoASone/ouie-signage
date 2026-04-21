// supabase/functions/devices-refresh/index.ts
import { serviceRoleClient } from "../_shared/supabase.ts";
import { mintDeviceAccessToken, generateRefreshToken, hashRefreshToken } from "../_shared/jwt.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const jwtSecret = Deno.env.get("DEVICE_JWT_SECRET");
  if (!jwtSecret) throw new Error("DEVICE_JWT_SECRET must be set");

  const body = await req.json().catch(() => ({}));
  const raw = body.refresh_token;
  if (typeof raw !== "string" || raw.length < 20) {
    return new Response("bad request", { status: 400 });
  }
  const h = await hashRefreshToken(raw);
  const svc = serviceRoleClient();

  const { data: device, error } = await svc.from("devices")
    .select("id, tenant_id, refresh_token_hash, access_token_ttl_seconds, revoked_at")
    .eq("refresh_token_hash", h).maybeSingle();

  if (error) return new Response("db: " + error.message, { status: 500 });
  if (!device) return new Response("invalid refresh", { status: 401 });
  if (device.revoked_at) return new Response("revoked", { status: 401 });

  const newRaw = generateRefreshToken();
  const newHash = await hashRefreshToken(newRaw);
  const now = new Date().toISOString();

  const { data: rotated, error: updErr } = await svc.from("devices").update({
    refresh_token_hash: newHash,
    refresh_token_last_used_at: now,
    refresh_token_issued_at: now,
  }).eq("id", device.id)
    .eq("refresh_token_hash", h)   // CAS guard — fails if another request rotated first
    .select("id")
    .maybeSingle();
  if (updErr) return new Response("db: " + updErr.message, { status: 500 });
  if (!rotated) return new Response("invalid refresh", { status: 401 });   // lost the race or stolen

  const accessToken = await mintDeviceAccessToken({
    deviceId: device.id,
    tenantId: device.tenant_id,
    ttlSeconds: device.access_token_ttl_seconds,
    secret: jwtSecret,
  });

  return Response.json({
    access_token: accessToken,
    refresh_token: newRaw,
    expires_in: device.access_token_ttl_seconds,
  });
});
