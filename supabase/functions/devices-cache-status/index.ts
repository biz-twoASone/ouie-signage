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
  if (!Array.isArray(body.events)) return new Response("bad body", { status: 400 });

  const svc = serviceRoleClient();
  const rows = body.events.map((e: any) => ({
    tenant_id: claims.tenant_id,
    device_id: claims.sub,
    media_id: e.media_id ?? null,
    state: e.state,
    message: e.message?.slice(0, 500) ?? null,
  }));
  const { error } = await svc.from("cache_events").insert(rows);
  if (error) return new Response("db: " + error.message, { status: 500 });
  return new Response(null, { status: 204 });
});
