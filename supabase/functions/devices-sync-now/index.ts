// supabase/functions/devices-sync-now/index.ts
// Dashboard-facing endpoint: authenticated tenant user asks the server to push
// a sync signal to one device or every device in a device group via FCM. Uses
// a user-scoped Supabase client so RLS policies enforce tenant isolation — if
// the caller can't see the device/group, the row lookup yields no data and we
// respond 403 without ever touching FCM.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendFcmSync } from "../_shared/fcm.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl) throw new Error("SUPABASE_URL must be set");
  if (!anonKey) throw new Error("SUPABASE_ANON_KEY must be set");

  const userJwt = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!userJwt) return new Response("unauthenticated", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const deviceId: string | undefined = body.device_id;
  const groupId: string | undefined = body.device_group_id;
  if (!deviceId && !groupId) return new Response("missing target", { status: 400 });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { persistSession: false },
  });

  const targetTokens: string[] = [];
  if (deviceId) {
    const { data, error } = await userClient.from("devices").select("id,fcm_token").eq(
      "id",
      deviceId,
    )
      .maybeSingle();
    if (error) return new Response("db: " + error.message, { status: 500 });
    if (!data) return new Response("forbidden", { status: 403 });
    if (data.fcm_token) targetTokens.push(data.fcm_token);
  } else if (groupId) {
    const { data, error } = await userClient.from("device_group_members")
      .select("device_id, devices!inner(fcm_token)").eq("device_group_id", groupId);
    if (error) return new Response("db: " + error.message, { status: 500 });
    for (const row of data ?? []) {
      const token = (row as { devices?: { fcm_token?: string | null } }).devices?.fcm_token;
      if (typeof token === "string" && token.length > 0) targetTokens.push(token);
    }
  }

  // Fire-and-forget. We don't want to block the dashboard on FCM latency, but
  // we do want a breadcrumb when sends fail so silent delivery problems are
  // visible in edge-function logs.
  const results = await Promise.allSettled(targetTokens.map((t) => sendFcmSync(t)));
  for (const r of results) {
    if (r.status === "rejected") console.error("sendFcmSync rejected:", r.reason);
  }
  return new Response(null, { status: 202 });
});
