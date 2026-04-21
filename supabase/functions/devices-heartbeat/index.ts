// supabase/functions/devices-heartbeat/index.ts
import { serviceRoleClient } from "../_shared/supabase.ts";
import { extractDeviceFromRequest } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  let claims;
  try {
    claims = await extractDeviceFromRequest(req, Deno.env.get("DEVICE_JWT_SECRET")!);
  } catch {
    return new Response("unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const svc = serviceRoleClient();
  const { error } = await svc.from("devices").update({
    last_seen_at: new Date().toISOString(),
    cache_storage_info: body.cache_storage_info ?? null,
  }).eq("id", claims.sub);
  if (error) return new Response("db: " + error.message, { status: 500 });

  // Errors from client would be persisted to a device_events table in a later plan.
  // For v1 backend, we just acknowledge.
  return new Response(null, { status: 204 });
});
