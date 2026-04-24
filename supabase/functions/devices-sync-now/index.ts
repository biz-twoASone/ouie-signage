// supabase/functions/devices-sync-now/index.ts
// Dashboard-facing endpoint: authenticated tenant user asks the server to push
// a sync signal to one device or every device in a device group via FCM. Uses
// a user-scoped Supabase client so RLS policies enforce tenant isolation — if
// the caller can't see the device/group, the row lookup yields no data and we
// respond 403 without ever touching FCM.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendFcmSync } from "../_shared/fcm.ts";
import { serviceRoleClient } from "../_shared/supabase.ts";

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

  // Stamp dispatch timestamp(s) on the target device row(s) for delivery-latency
  // tracking. Uses service-role client so RLS doesn't block the write. Separate
  // from the FCM send so a DB failure doesn't block the push and vice versa.
  const dispatchedAt = new Date().toISOString();
  const svc = serviceRoleClient();
  if (deviceId) {
    await svc.from("devices")
      .update({ last_sync_now_dispatched_at: dispatchedAt })
      .eq("id", deviceId);
  } else if (groupId) {
    // For group sends, update every member device that we have a token for.
    // Skip the DB lookup if we ended up with no tokens (nothing to time).
    if (targetTokens.length > 0) {
      const memberIds = await userClient.from("device_group_members")
        .select("device_id")
        .eq("device_group_id", groupId);
      const ids = (memberIds.data ?? []).map((r: { device_id: string }) => r.device_id);
      if (ids.length > 0) {
        await svc.from("devices")
          .update({ last_sync_now_dispatched_at: dispatchedAt })
          .in("id", ids);
      }
    }
  }

  // Plan 5 Task 18: capture FCM dispatch outcome per-token and stamp the
  // result onto the originating device row(s). Server timestamp is captured
  // before send (already in `dispatchedAt`). Single-device path stamps that
  // device; group path zips results back to member device IDs.
  const results = await Promise.allSettled(targetTokens.map((t) => sendFcmSync(t)));
  if (deviceId) {
    const r = results[0];
    const update: Record<string, string | null> = {
      last_fcm_dispatched_at: dispatchedAt,
      last_fcm_dispatch_message_id: null,
      last_fcm_dispatch_error: null,
    };
    if (r?.status === "fulfilled" && r.value.ok) {
      update.last_fcm_dispatch_message_id = r.value.messageId;
    } else {
      update.last_fcm_dispatch_error = r?.status === "fulfilled"
        ? (r.value as { error: string }).error
        : `rejected: ${String((r as PromiseRejectedResult)?.reason ?? "unknown")}`;
    }
    await svc.from("devices").update(update).eq("id", deviceId);
  } else if (groupId) {
    // Group send: zip token results back to device IDs in the order we built them.
    const memberIds = await userClient.from("device_group_members")
      .select("device_id, devices!inner(fcm_token)")
      .eq("device_group_id", groupId);
    const ordered = (memberIds.data ?? [])
      .map((row) =>
        ({
          deviceId: (row as { device_id: string }).device_id,
          token: (row as { devices?: { fcm_token?: string | null } }).devices?.fcm_token ?? null,
        })
      )
      .filter((m) => typeof m.token === "string" && m.token.length > 0);
    for (let i = 0; i < ordered.length; i++) {
      const r = results[i];
      const update: Record<string, string | null> = {
        last_fcm_dispatched_at: dispatchedAt,
        last_fcm_dispatch_message_id: null,
        last_fcm_dispatch_error: null,
      };
      if (r?.status === "fulfilled" && r.value.ok) {
        update.last_fcm_dispatch_message_id = r.value.messageId;
      } else {
        update.last_fcm_dispatch_error = r?.status === "fulfilled"
          ? (r.value as { error: string }).error
          : `rejected: ${String((r as PromiseRejectedResult)?.reason ?? "unknown")}`;
      }
      await svc.from("devices").update(update).eq("id", ordered[i].deviceId);
    }
  }
  return new Response(null, { status: 202 });
});
