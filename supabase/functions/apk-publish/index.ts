// supabase/functions/apk-publish/index.ts
// Plan 5 Phase 1 Task 3.
// Dashboard-facing: authenticated tenant user finalizes an APK release after
// the bytes have been PUT to R2 via apk-upload-url. We update the tenants
// pointer atomically with a monotonic version_code guard — refusing publishes
// where new version_code <= current. Sha256 is required and must be 64 hex
// chars (we don't re-hash the R2 object — the device verifies post-download).
//
// Implementation note: tenants table has only a SELECT RLS policy for
// authenticated users (no UPDATE policy — by design, per project convention).
// We verify user→tenant mapping via user JWT (tenant_members SELECT RLS
// permits this), then execute the monotonic UPDATE via the service-role client
// with explicit tenant_id scoping — same pattern as other device-facing
// Edge Functions in this project.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { serviceRoleClient } from "../_shared/supabase.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl) throw new Error("SUPABASE_URL must be set");
  if (!anonKey) throw new Error("SUPABASE_ANON_KEY must be set");

  const userJwt = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!userJwt) return new Response("unauthenticated", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const versionCode = typeof body.version_code === "number" ? body.version_code : 0;
  const versionName = typeof body.version_name === "string" ? body.version_name : "";
  const r2Path = typeof body.r2_path === "string" ? body.r2_path : "";
  const sha256 = typeof body.sha256 === "string" ? body.sha256 : "";
  if (versionCode <= 0) return new Response("missing version_code", { status: 400 });
  if (!versionName) return new Response("missing version_name", { status: 400 });
  if (!r2Path) return new Response("missing r2_path", { status: 400 });
  if (!SHA256_HEX.test(sha256)) return new Response("malformed sha256", { status: 400 });

  // Verify user's tenant membership via user-scoped client (tenant_members
  // SELECT RLS allows this).
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { persistSession: false },
  });

  const { data: tm, error: tmErr } = await userClient
    .from("tenant_members")
    .select("tenant_id")
    .maybeSingle();
  if (tmErr) return new Response("db: " + tmErr.message, { status: 500 });
  if (!tm) return new Response("no tenant", { status: 403 });

  // Conditional UPDATE via service-role client (tenants has no UPDATE RLS
  // policy for authenticated users — project convention: dashboard-facing
  // Edge Functions use service-role with explicit tenant_id scoping).
  // Only succeeds when (current is NULL) OR (new > current).
  // Returns the row on success, null on conflict — distinguish via null check.
  const svc = serviceRoleClient();
  const { data: updated, error: updErr } = await svc
    .from("tenants")
    .update({
      latest_apk_version_code: versionCode,
      latest_apk_version_name: versionName,
      latest_apk_r2_path: r2Path,
      latest_apk_sha256: sha256,
      latest_apk_released_at: new Date().toISOString(),
    })
    .eq("id", tm.tenant_id)
    .or(
      `latest_apk_version_code.is.null,latest_apk_version_code.lt.${versionCode}`,
    )
    .select("id")
    .maybeSingle();
  if (updErr) return new Response("db: " + updErr.message, { status: 500 });
  if (!updated) return new Response("non-monotonic version_code", { status: 409 });

  return new Response(null, { status: 200 });
});
