// supabase/functions/tests/error_events.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

Deno.test({
  name: "heartbeat persists errors_since_last_heartbeat into device_error_events",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const errorEvent1 = {
      timestamp: "2026-04-23T10:00:00.000Z",
      kind: "playback_failed",
      media_id: null,
      message: "codec not supported",
    };
    const errorEvent2 = {
      timestamp: "2026-04-23T10:00:05.000Z",
      kind: "download_failed",
      media_id: null,
      message: null,
    };

    const r = await fetch(`${FN}/devices-heartbeat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        app_version: "test",
        uptime_seconds: 10,
        errors_since_last_heartbeat: [errorEvent1, errorEvent2],
      }),
    });
    assertEquals(r.status, 204);
    await r.body?.cancel();

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: rows, error } = await svc.from("device_error_events")
      .select("kind, media_id, message, occurred_at")
      .eq("device_id", creds.device_id)
      .order("occurred_at", { ascending: true });
    assertEquals(error, null);
    assertEquals(rows?.length, 2);
    assertEquals(rows?.[0].kind, "playback_failed");
    assertEquals(rows?.[0].message, "codec not supported");
    assertEquals(rows?.[0].occurred_at, "2026-04-23T10:00:00+00:00");
    assertEquals(rows?.[1].kind, "download_failed");
    assertEquals(rows?.[1].message, null);
    assertEquals(rows?.[1].occurred_at, "2026-04-23T10:00:05+00:00");
  },
});

Deno.test({
  name: "heartbeat with empty errors_since_last_heartbeat inserts zero rows",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const r = await fetch(`${FN}/devices-heartbeat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        app_version: "test",
        uptime_seconds: 10,
        errors_since_last_heartbeat: [],
      }),
    });
    assertEquals(r.status, 204);
    await r.body?.cancel();

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { count } = await svc.from("device_error_events")
      .select("id", { count: "exact", head: true })
      .eq("device_id", creds.device_id);
    assertEquals(count, 0);
  },
});

Deno.test({
  name: "heartbeat omits non-uuid media_id rather than rejecting whole batch",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const r = await fetch(`${FN}/devices-heartbeat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        app_version: "test",
        uptime_seconds: 10,
        errors_since_last_heartbeat: [
          {
            timestamp: "2026-04-23T10:00:00.000Z",
            kind: "download_failed",
            media_id: "not-a-uuid",
            message: "coerced to null",
          },
        ],
      }),
    });
    assertEquals(r.status, 204);
    await r.body?.cancel();

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: rows } = await svc.from("device_error_events")
      .select("kind, media_id")
      .eq("device_id", creds.device_id);
    assertEquals(rows?.length, 1);
    assertEquals(rows?.[0].media_id, null);
    assertEquals(rows?.[0].kind, "download_failed");
  },
});

Deno.test({
  name: "heartbeat with malformed timestamp falls back to server time, batch still succeeds",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const r = await fetch(`${FN}/devices-heartbeat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        app_version: "test",
        uptime_seconds: 10,
        errors_since_last_heartbeat: [
          {
            timestamp: "2026-04-23T10:00:00.000Z",
            kind: "good_event",
            media_id: null,
            message: "well-formed",
          },
          {
            timestamp: "not-a-date",
            kind: "bad_timestamp",
            media_id: null,
            message: "should fall back",
          },
        ],
      }),
    });
    assertEquals(r.status, 204);
    await r.body?.cancel();

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: rows } = await svc.from("device_error_events")
      .select("kind, occurred_at")
      .eq("device_id", creds.device_id)
      .order("kind", { ascending: true });
    assertEquals(rows?.length, 2);
    // Good event: preserved timestamp.
    const good = rows?.find((r) => r.kind === "good_event");
    assertEquals(good?.occurred_at, "2026-04-23T10:00:00+00:00");
    // Bad event: server time fallback, NOT the literal "not-a-date" string.
    const bad = rows?.find((r) => r.kind === "bad_timestamp");
    // Just verify it's a parseable ISO timestamp (close to "now"), not the garbage input.
    const badParsed = new Date(bad?.occurred_at ?? "");
    const ageSeconds = (Date.now() - badParsed.getTime()) / 1000;
    // Should be within last 60 seconds (cite: test runs complete in well under 60s locally).
    if (ageSeconds < 0 || ageSeconds > 60) {
      throw new Error(`bad_timestamp occurred_at (${bad?.occurred_at}) not a recent fallback`);
    }
  },
});
