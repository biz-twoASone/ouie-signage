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
  if (Array.isArray(body.errors_since_last_heartbeat) && body.errors_since_last_heartbeat.length > 0) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const errorRows = body.errors_since_last_heartbeat
      .filter((e: unknown): e is Record<string, unknown> => typeof e === "object" && e !== null)
      .map((e: Record<string, unknown>) => ({
        tenant_id: claims.tenant_id,
        device_id: claims.sub,
        kind: typeof e.kind === "string" ? e.kind : "unknown",
        media_id: typeof e.media_id === "string" && UUID_RE.test(e.media_id) ? e.media_id : null,
        message: typeof e.message === "string" ? e.message.slice(0, 500) : null,
        occurred_at: typeof e.timestamp === "string" ? e.timestamp : new Date().toISOString(),
      }));
    if (errorRows.length > 0) {
      const { error: insertError } = await svc.from("device_error_events").insert(errorRows);
      if (insertError) {
        // Log but don't fail heartbeat — device shouldn't retry on error-log failure.
        console.error(`device=${claims.sub} device_error_events insert failed: ${insertError.message}`);
      }
    }
  }

  const { error } = await svc.from("devices").update(update).eq("id", claims.sub).is("revoked_at", null);
  if (error) return new Response("db: " + error.message, { status: 500 });

  return new Response(null, { status: 204 });
});
