// supabase/functions/devices-config/index.ts
import { serviceRoleClient } from "../_shared/supabase.ts";
import { extractDeviceFromRequest } from "../_shared/auth.ts";
import { presignR2GetUrl, r2ConfigFromEnv } from "../_shared/r2.ts";

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response("method", { status: 405 });

  const jwtSecret = Deno.env.get("DEVICE_JWT_SECRET");
  if (!jwtSecret) throw new Error("DEVICE_JWT_SECRET must be set");

  let claims;
  try {
    claims = await extractDeviceFromRequest(req, jwtSecret);
  } catch {
    return new Response("unauthorized", { status: 401 });
  }

  const svc = serviceRoleClient();

  // Revocation check
  const { data: dev, error: devErr } = await svc.from("devices")
    .select("id, tenant_id, store_id, fallback_playlist_id, revoked_at, stores(timezone)")
    .eq("id", claims.sub).single();
  if (devErr || !dev) return new Response("device gone", { status: 401 });
  if (dev.revoked_at) return new Response("revoked", { status: 401 });

  // Collect groups this device belongs to:
  const { data: groups } = await svc.from("device_group_members")
    .select("device_group_id").eq("device_id", dev.id);
  const groupIds = (groups ?? []).map((g) => g.device_group_id);

  // Rules targeting this device OR any of its groups, currently effective:
  const { data: rules } = await svc.from("dayparting_rules")
    .select(
      "id, playlist_id, target_device_id, target_device_group_id, days_of_week, start_time, end_time, effective_at",
    )
    .or(
      `target_device_id.eq.${dev.id}` +
        (groupIds.length ? `,target_device_group_id.in.(${groupIds.join(",")})` : ""),
    )
    .lte("effective_at", new Date().toISOString())
    .order("effective_at", { ascending: false })
    .order("id", { ascending: true });

  // Collect all referenced playlists:
  const playlistIds = new Set<string>();
  (rules ?? []).forEach((r) => playlistIds.add(r.playlist_id));
  if (dev.fallback_playlist_id) playlistIds.add(dev.fallback_playlist_id);

  const { data: playlists } = playlistIds.size
    ? await svc.from("playlists")
      .select("id, name, updated_at, playlist_items(id, media_id, position, duration_seconds)")
      .in("id", [...playlistIds])
    : { data: [] };

  // Collect media referenced:
  const mediaIds = new Set<string>();
  (playlists ?? []).forEach((p) => p.playlist_items.forEach((it) => mediaIds.add(it.media_id)));

  const { data: mediaRows } = mediaIds.size
    ? await svc.from("media")
      .select("id, kind, r2_path, size_bytes, checksum, video_duration_seconds")
      .in("id", [...mediaIds])
    : { data: [] };

  const r2cfg = r2ConfigFromEnv();
  const mediaWithUrls = await Promise.all((mediaRows ?? []).map(async (m) => ({
    id: m.id,
    kind: m.kind,
    size_bytes: m.size_bytes,
    checksum: m.checksum,
    video_duration_seconds: m.video_duration_seconds,
    url: await presignR2GetUrl({ ...r2cfg, key: m.r2_path, ttlSeconds: 86400 }),
  })));

  const payload = {
    device: {
      id: dev.id,
      store_id: dev.store_id,
      fallback_playlist_id: dev.fallback_playlist_id,
      // PostgREST types `stores(timezone)` embed as `stores: {timezone: any}[]`
      // (array form for to-one FK), so narrow via `unknown` to the runtime shape.
      timezone: (dev as unknown as { stores: { timezone: string } }).stores.timezone,
    },
    rules: rules ?? [],
    playlists: (playlists ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      updated_at: p.updated_at,
      items: p.playlist_items
        .sort((a, b) => a.position - b.position)
        .map((i) => ({
          media_id: i.media_id,
          position: i.position,
          duration_seconds: i.duration_seconds,
        })),
    })),
    media: mediaWithUrls,
  };

  // Version hash excludes URL (which rotates with expiry) — based on content identity:
  const stable = JSON.stringify({
    device: { ...payload.device },
    rules: payload.rules,
    playlists: payload.playlists,
    media: mediaWithUrls.map((m) => ({
      id: m.id,
      kind: m.kind,
      checksum: m.checksum,
      size_bytes: m.size_bytes,
    })),
  });
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable));
  const version = "sha256:" +
    Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");

  const etag = `"${version}"`;
  // RFC 7232 §3.2: If-None-Match uses weak comparison. Strip an optional W/
  // prefix and compare the opaque-tag bytes. Needed because the Deno/edge
  // runtime auto-weakens strong ETags when compression is negotiated,
  // causing the client to echo back `W/"sha256:..."` even though we set
  // `"sha256:..."` on the 200 response.
  const inm = req.headers.get("If-None-Match");
  if (inm && inm.replace(/^W\//, "") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return new Response(JSON.stringify({ version, ...payload }), {
    status: 200,
    headers: { "content-type": "application/json", ETag: etag },
  });
});
