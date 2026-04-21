// supabase/functions/pairing-status/index.ts
// Note: pairing-status is stateful-read only; since claim returns tokens directly
// to dashboard, the TV gets tokens by polling /pairing-status with its own
// proof-of-pairing — the initial pairing row contains the tokens (hashed) only.
// For v1 simplicity: the TV polls with the `code`; if claimed, we return the
// device_id + a one-time-use pickup token (stored ephemerally in pairing_requests.metadata).
// We implement this by having pairing-claim stash the RAW refresh + access tokens
// temporarily in a "tv_pickup" JSONB column on the pairing_requests row, which
// pairing-status drains on first read.

import { serviceRoleClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response("method", { status: 405 });
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return new Response("missing code", { status: 400 });

  const svc = serviceRoleClient();
  const { data, error } = await svc
    .from("pairing_requests")
    .select("code, expires_at, claimed_at, claimed_device_id, tv_pickup")
    .eq("code", code).maybeSingle();

  if (error) return new Response("db: " + error.message, { status: 500 });
  if (!data) return new Response("not found", { status: 404 });

  if (!data.claimed_at) {
    if (new Date(data.expires_at) < new Date()) {
      return Response.json({ status: "expired" });
    }
    return Response.json({ status: "pending" });
  }

  // Paired. Drain the pickup bundle (one-time).
  if (data.tv_pickup) {
    await svc.from("pairing_requests").update({ tv_pickup: null }).eq("code", code);
    return Response.json({
      status: "paired",
      device_id: data.claimed_device_id,
      ...data.tv_pickup,
    });
  }
  // Already picked up once; second read gets just the device_id:
  return Response.json({
    status: "paired_pickup_consumed",
    device_id: data.claimed_device_id,
  });
});
