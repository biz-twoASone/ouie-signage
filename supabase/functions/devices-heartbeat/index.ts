// supabase/functions/devices-heartbeat/index.ts
import { serviceRoleClient } from "../_shared/supabase.ts";
import { extractDeviceFromRequest } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const jwtSecret = Deno.env.get("DEVICE_JWT_SECRET");
  if (!jwtSecret) throw new Error("DEVICE_JWT_SECRET must be set");

  let claims;
  try {
    claims = await extractDeviceFromRequest(req, jwtSecret);
  } catch {
    return new Response("unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const svc = serviceRoleClient();
  const update: Record<string, unknown> = {
    last_seen_at: new Date().toISOString(),
    cache_storage_info: body.cache_storage_info ?? null,
  };
  if (typeof body.app_version === "string") update.current_app_version = body.app_version;
  if (typeof body.current_playlist_id === "string") update.current_playlist_id = body.current_playlist_id;
  if (typeof body.last_config_version_applied === "string") update.last_config_version_applied = body.last_config_version_applied;
  if (typeof body.clock_skew_seconds_from_server === "number") update.clock_skew_seconds_from_server = body.clock_skew_seconds_from_server;
  if (typeof body.fcm_token === "string" && body.fcm_token.length > 0) {
    update.fcm_token = body.fcm_token;
  }
  // errors_since_last_heartbeat: accepted but not persisted in v1; the device
  // emits it per spec §8, server-side storage is a follow-up plan. Log count
  // so edge function logs give visibility.
  if (Array.isArray(body.errors_since_last_heartbeat) && body.errors_since_last_heartbeat.length > 0) {
    console.log(`device=${claims.sub} errors=${body.errors_since_last_heartbeat.length}`);
  }

  const { error } = await svc.from("devices").update(update).eq("id", claims.sub).is("revoked_at", null);
  if (error) return new Response("db: " + error.message, { status: 500 });

  return new Response(null, { status: 204 });
});
