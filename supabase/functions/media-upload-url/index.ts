// supabase/functions/media-upload-url/index.ts
// Dashboard-facing: authenticated tenant user requests an R2 presigned PUT URL
// to upload a new media file. Server inserts a "pending" media row first so
// the upload has a stable media_id to reference. Client PUTs to R2, then calls
// a separate server action to finalize the row (upload_state='uploaded',
// checksum, and — for videos — video_duration_seconds).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { presignR2PutUrl, r2ConfigFromEnv } from "../_shared/r2.ts";

function kindFromMime(mime: string): "video" | "image" | null {
  if (mime === "video/mp4") return "video";
  if (mime === "image/jpeg" || mime === "image/png") return "image";
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl) throw new Error("SUPABASE_URL must be set");
  if (!anonKey) throw new Error("SUPABASE_ANON_KEY must be set");

  const userJwt = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!userJwt) return new Response("unauthenticated", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const filename = typeof body.filename === "string" ? body.filename : "";
  const mime = typeof body.mime_type === "string" ? body.mime_type : "";
  const size = typeof body.size_bytes === "number" ? body.size_bytes : 0;
  if (!filename || !mime || size <= 0) {
    return new Response("missing filename, mime_type, or size_bytes", { status: 400 });
  }
  if (size > 500 * 1024 * 1024) {
    return new Response("file too large (max 500 MB)", { status: 413 });
  }
  const kind = kindFromMime(mime);
  if (!kind) return new Response("unsupported mime type", { status: 415 });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { persistSession: false },
  });

  // Resolve caller's tenant (RLS-scoped). The tenant-bootstrap trigger (Plan 2
  // Task 6) ensures every authenticated user has exactly one tenant_members row.
  const { data: tm, error: tmErr } = await userClient
    .from("tenant_members")
    .select("tenant_id")
    .maybeSingle();
  if (tmErr) return new Response("db: " + tmErr.message, { status: 500 });
  if (!tm) return new Response("no tenant", { status: 403 });

  const ext = filename.includes(".") ? filename.split(".").pop() : "";
  const mediaId = crypto.randomUUID();
  const r2Path = `tenants/${tm.tenant_id}/media/${mediaId}${ext ? "." + ext : ""}`;

  const { data: inserted, error: insErr } = await userClient
    .from("media")
    .insert({
      id: mediaId,
      tenant_id: tm.tenant_id,
      kind,
      mime_type: mime,
      original_filename: filename,
      size_bytes: size,
      r2_path: r2Path,
      upload_state: "pending",
      // checksum + video_duration_seconds populated later by finalize action
    })
    .select("id")
    .single();
  if (insErr) return new Response("db: " + insErr.message, { status: 500 });
  if (!inserted) return new Response("insert returned no row", { status: 500 });

  const ttlSeconds = 10 * 60; // 10 min
  const upload_url = await presignR2PutUrl({
    ...r2ConfigFromEnv(),
    key: r2Path,
    ttlSeconds,
    contentType: mime,
  });
  const expires_at = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  return Response.json({ media_id: inserted.id, upload_url, expires_at });
});
