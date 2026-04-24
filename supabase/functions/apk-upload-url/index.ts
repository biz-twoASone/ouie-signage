// supabase/functions/apk-upload-url/index.ts
// Plan 5 Phase 1 Task 2.
// Dashboard-facing: authenticated tenant user requests a presigned R2 PUT URL
// for an APK upload. Caller PUTs the bytes, then calls apk-publish to flip
// the tenant's pointer columns atomically (with monotonic version_code guard).
// We do NOT pre-insert any row here — the tenant's "current latest APK" is a
// single set of columns on the tenants table, set only on successful publish.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { presignR2PutUrl, r2ConfigFromEnv } from "../_shared/r2.ts";

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
  const sizeBytes = typeof body.size_bytes === "number" ? body.size_bytes : 0;
  if (versionCode <= 0) return new Response("missing version_code", { status: 400 });
  if (sizeBytes <= 0) return new Response("missing size_bytes", { status: 400 });
  // 200 MB ceiling — typical Android TV APK is 30–80 MB; this leaves headroom
  // for native libs and bundled fonts without enabling pathological uploads.
  if (sizeBytes > 200 * 1024 * 1024) {
    return new Response("apk too large (max 200 MB)", { status: 413 });
  }

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

  const r2Path = `tenants/${tm.tenant_id}/apks/${versionCode}.apk`;
  const ttlSeconds = 10 * 60; // 10 min — same as media-upload-url
  const upload_url = await presignR2PutUrl({
    ...r2ConfigFromEnv(),
    key: r2Path,
    ttlSeconds,
    contentType: "application/vnd.android.package-archive",
  });
  const expires_at = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  return Response.json({ r2_path: r2Path, upload_url, expires_at });
});
