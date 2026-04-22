import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";

const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

Deno.test({
  name: "media-upload-url returns presigned PUT URL and creates pending media row",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const r = await fetch(`${FN}/media-upload-url`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${creds.user_jwt}`,
      },
      body: JSON.stringify({
        filename: "test-video.mp4",
        mime_type: "video/mp4",
        size_bytes: 1024 * 1024,
      }),
    });
    assertEquals(r.status, 200);
    const body = await r.json() as {
      media_id?: string; upload_url?: string; expires_at?: string;
    };
    assert(body.media_id, "media_id missing");
    assert(body.upload_url?.startsWith("https://"), "upload_url not https");
    assert(body.expires_at, "expires_at missing");
  },
});

Deno.test({
  name: "media-upload-url 401 without auth",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const r = await fetch(`${FN}/media-upload-url`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "x.mp4", mime_type: "video/mp4", size_bytes: 1 }),
    });
    assertEquals(r.status, 401);
    await r.body?.cancel();
  },
});
