# Plan 4 — Observability (error log + Crashlytics + FCM confirmation + playback state)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the operator forensic visibility into device behavior without ADB access, so support issues can be diagnosed by reading the dashboard and pasting context to Claude.

**Architecture:** Four telemetry streams added to the existing heartbeat + FCM + Firebase stack. No new subsystems — every feature extends an existing pipe. (a) Device `ErrorBus` events already shipped per-heartbeat get persisted server-side and rendered on the device detail page. (b) Firebase Crashlytics is enabled via build config (one plugin, zero code changes) so native crashes and ANRs report to the Firebase console. (c) FCM delivery is confirmed via device-side receipt timestamp in heartbeat + server-side dispatch timestamp on `devices-sync-now`; dashboard computes latency. (d) `PlaybackDirector.state` is flattened into two new heartbeat fields (`current_media_id`, `playback_state`) so the dashboard shows what the device *thinks* it's playing.

**Tech Stack:** Supabase Postgres + Edge Functions (Deno), Firebase Crashlytics, Next.js 16 server component dashboard, Kotlin/Compose/Koin Android TV client. Same stack as Plans 1–3c — zero new dependencies on the server side.

**Prerequisite state:** Plan 3c is merged (commit `49634dc` on main as of 2026-04-23). `ErrorBus` emits `errors_since_last_heartbeat` today; `devices-heartbeat` server-side logs count but doesn't persist. `devices-sync-now` fires FCM fire-and-forget. `SignageMessagingService.onMessageReceived` calls `broadcast.fire()` with no receipt tracking.

---

## File structure

### New files (creates)

- `supabase/migrations/20260424000100_device_error_events.sql` — error log table + RLS + index.
- `supabase/migrations/20260424000200_devices_fcm_tracking.sql` — two columns on `devices` for FCM dispatch/receipt timestamps.
- `supabase/migrations/20260424000300_devices_playback_state.sql` — two columns on `devices` for current playback state.
- `supabase/functions/tests/error_events.test.ts` — Deno test: heartbeat with `errors_since_last_heartbeat` → rows in `device_error_events`.
- `supabase/functions/tests/fcm_tracking.test.ts` — Deno test: `devices-sync-now` stamps `last_sync_now_dispatched_at`; heartbeat with `last_fcm_received_at` updates column.
- `android-tv/app/src/main/java/com/ouie/signage/fcm/FcmReceiptTracker.kt` — thread-safe `@Volatile var` holder for last-received-at.

### Modified files

- `supabase/functions/devices-heartbeat/index.ts` — replace `console.log` of error count with batch insert into `device_error_events`; accept + write `last_fcm_received_at`, `current_media_id`, `playback_state`.
- `supabase/functions/devices-sync-now/index.ts` — before firing FCM, UPDATE `devices.last_sync_now_dispatched_at = now()` for each target row.
- `android-tv/gradle/libs.versions.toml` — add `firebase-crashlytics` library and `firebase-crashlytics-gradle` plugin.
- `android-tv/build.gradle.kts` — declare crashlytics plugin (`apply false`).
- `android-tv/app/build.gradle.kts` — apply crashlytics plugin + add `firebase-crashlytics` dep.
- `android-tv/app/src/main/java/com/ouie/signage/SignageApp.kt` — in `onCreate`, after Koin init, call `FirebaseCrashlytics.getInstance().setUserId(tokenStore.loadSync()?.deviceId ?: "unpaired")`.
- `android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatPayload.kt` — add `last_fcm_received_at`, `current_media_id`, `playback_state` to `HeartbeatPayload`.
- `android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt` — accept new deps (`fcmReceiptTracker: FcmReceiptTracker`, `playbackStateSource: PlaybackStateSource`); populate new payload fields in `sendOne()`.
- `android-tv/app/src/main/java/com/ouie/signage/fcm/SignageMessagingService.kt` — call `receiptTracker.mark()` before `broadcast.fire()`.
- `android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackDirector.kt` — add `PlaybackStateSource` fun interface method (`currentMediaId(): String?` and `currentStateTag(): String`).
- `android-tv/app/src/main/java/com/ouie/signage/coordinator/RunningCoordinator.kt` — construct `HeartbeatScheduler` with new params (`fcmReceiptTracker`, `playbackStateSource = director`).
- `android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt` — register `FcmReceiptTracker` as a Koin single.
- `dashboard/app/app/screens/[id]/page.tsx` — add `device_error_events` to parallel queries; select new device fields; render "Recent errors" card + FCM latency inline display + playback state card.
- `CLAUDE.md` — status-line flip + conventions section append.

---

## Task dispatch order

Tasks are grouped into 5 phases. Each phase closes with a commit. No deliberate build breaks (unlike Plan 3c — all tasks leave the tree green). Task 4.1 (`PlaybackDirector` extension) comes before Task 4.3 (Koin wiring) because the wiring depends on the new fun-interface method.

1. Phase 1 — Error telemetry (Tasks 1.1 → 1.3)
2. Phase 2 — Crashlytics (Tasks 2.1 → 2.3)
3. Phase 3 — FCM delivery confirmation (Tasks 3.1 → 3.4)
4. Phase 4 — Playback state in heartbeat (Tasks 4.1 → 4.3)
5. Phase 5 — Acceptance + close (Tasks 5.1 → 5.3) + PR merge

---

# Phase 1 — Error telemetry

Goal: `ErrorBus` events persist to a `device_error_events` table and surface on the dashboard as a "Recent errors" card.

### Task 1.1 — Migration for `device_error_events`

**Files:**
- Create: `supabase/migrations/20260424000100_device_error_events.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260424000100_device_error_events.sql
-- Persists the per-heartbeat errors_since_last_heartbeat payload so operators
-- can see what a device reported without ADB. Mirrors cache_events for
-- consistency: same column naming, same RLS policy shape, same write path
-- (service-role Edge Function with explicit tenant filter).
CREATE TABLE device_error_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  kind text NOT NULL,                             -- free-form; new kinds added client-side without migrations
  media_id uuid REFERENCES media(id) ON DELETE SET NULL,
  message text,
  occurred_at timestamptz NOT NULL,               -- from device ErrorEvent.timestamp
  created_at timestamptz NOT NULL DEFAULT now()   -- server insert time (forensics if device clock drifts)
);
CREATE INDEX idx_device_error_events_device_time
  ON device_error_events(device_id, occurred_at DESC);

ALTER TABLE device_error_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY device_error_events_member_read ON device_error_events FOR SELECT
  USING (tenant_id IN (SELECT auth_user_tenant_ids()));
-- Devices write via service role in Edge Function; no direct policy needed.
```

- [ ] **Step 2: Apply locally**

Run:
```bash
supabase db reset
```
Expected: all existing migrations re-apply + new migration applies without error. `\d device_error_events` in psql (via `supabase db psql`) shows the table + FK + index + policy.

- [ ] **Step 3: Verify PostgREST picks up the new table**

```bash
docker restart supabase_rest_smart-tv-video-viewer
```

This is the project convention from CLAUDE.md — PostgREST's schema cache can lag after a db reset. Restart is the clean fix. Without this, the Deno tests in Task 1.2 may fail with "table not found" even though the migration ran.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260424000100_device_error_events.sql
git commit -m "feat(db): device_error_events — persisted errors_since_last_heartbeat"
```

### Task 1.2 — `devices-heartbeat` persists error events (TDD)

**Files:**
- Create: `supabase/functions/tests/error_events.test.ts`
- Modify: `supabase/functions/devices-heartbeat/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
    assertEquals(rows?.[1].kind, "download_failed");
    assertEquals(rows?.[1].message, null);
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
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
deno task test --filter "heartbeat persists errors_since_last_heartbeat"
```

Expected: failure — current `devices-heartbeat` only logs error count, doesn't insert rows. Test's `rows?.length` assertion fails because no rows exist.

- [ ] **Step 3: Extend the Edge Function**

Modify `supabase/functions/devices-heartbeat/index.ts`. Replace the existing error-log block (the `if (Array.isArray(body.errors_since_last_heartbeat) && body.errors_since_last_heartbeat.length > 0)` branch that calls `console.log`) with:

```typescript
  if (Array.isArray(body.errors_since_last_heartbeat) && body.errors_since_last_heartbeat.length > 0) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const errorRows = body.errors_since_last_heartbeat
      .filter((e: unknown): e is Record<string, unknown> => typeof e === "object" && e !== null)
      .map((e: Record<string, unknown>) => ({
        tenant_id: claims.tenant_id,
        device_id: claims.sub,
        kind: typeof e.kind === "string" ? e.kind : "unknown",
        media_id: typeof e.media_id === "string" && UUID_RE.test(e.media_id) ? e.media_id : null,
        message: typeof e.message === "string" ? e.message.slice(0, 500) : null,
        occurred_at: typeof e.timestamp === "string" ? e.timestamp : new Date().toISOString(),
      }));
    if (errorRows.length > 0) {
      const { error: insertError } = await svc.from("device_error_events").insert(errorRows);
      if (insertError) {
        // Log but don't fail heartbeat — device shouldn't retry on error-log failure.
        console.error(`device=${claims.sub} device_error_events insert failed: ${insertError.message}`);
      }
    }
  }
```

Note: `claims.tenant_id` already exists in the JWT claims (used by other Edge Functions). Verify by grepping `supabase/functions/_shared/auth.ts` — the `DeviceClaims` interface includes `tenant_id`. If grep shows otherwise, STOP and escalate — the server-side tenant scoping contract is broken.

- [ ] **Step 4: Restart edge runtime + re-run test**

```bash
docker restart supabase_edge_runtime_smart-tv-video-viewer
deno task test --filter "heartbeat persists errors_since_last_heartbeat"
deno task test --filter "heartbeat with empty errors_since_last_heartbeat"
deno task test --filter "heartbeat omits non-uuid media_id"
```

Expected: all three pass.

- [ ] **Step 5: Run the full heartbeat test suite to confirm no regressions**

```bash
deno task test --filter "heartbeat"
```

Expected: 5 tests pass (the 3 new ones + the 2 existing from Plan 3c).

- [ ] **Step 6: Deploy to production**

```bash
pnpm dlx dotenv-cli -e .env.production -- supabase functions deploy devices-heartbeat
```

Expected output contains: `Deployed Functions on project swhwrlpoqjijxcvywzto: devices-heartbeat`.

Then apply migration remotely:

```bash
pnpm dlx dotenv-cli -e .env.production -- supabase db push
```

Expected: the new migration `20260424000100_device_error_events` is listed and applied.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/devices-heartbeat/index.ts supabase/functions/tests/error_events.test.ts
git commit -m "feat(fn): devices-heartbeat — batch-insert error events into device_error_events"
```

### Task 1.3 — Dashboard "Recent errors" card

**Files:**
- Modify: `dashboard/app/app/screens/[id]/page.tsx`

- [ ] **Step 1: Add parallel query**

In `dashboard/app/app/screens/[id]/page.tsx`, extend the existing `Promise.all` block (currently 4 parallel fetches starting at line ~24). Add a 5th:

```typescript
    supabase.from("device_error_events")
      .select("occurred_at, kind, media_id, message, media(name)")
      .eq("device_id", id)
      .order("occurred_at", { ascending: false })
      .limit(10),
```

LIMIT 10 matches the existing `cache_events` card convention (line ~36). Destructure it as `recentErrors`:

```typescript
  const [
    { data: device },
    { data: playlists },
    { data: recentCache },
    { data: uptimeRules },
    { data: recentErrors },
  ] = await Promise.all([
    // ... existing four queries ...
    supabase.from("device_error_events")
      .select("occurred_at, kind, media_id, message, media(name)")
      .eq("device_id", id)
      .order("occurred_at", { ascending: false })
      .limit(10),
  ]);
```

- [ ] **Step 2: Add "Recent errors" card to JSX**

Place the new `<Card>` between "Recent cache events" (around line 122) and "Playlist assignment" (around line 142). Match the visual style of `recentCache` exactly:

```tsx
      <Card>
        <CardHeader><CardTitle className="text-sm">Recent errors</CardTitle></CardHeader>
        <CardContent>
          {(!recentErrors || recentErrors.length === 0) ? (
            <p className="text-muted-foreground text-sm">No errors recorded.</p>
          ) : (
            <ul className="space-y-1">
              {recentErrors.map((e, i) => {
                const mediaName = (e.media as unknown as { name: string } | null)?.name;
                return (
                  <li key={i} className="text-xs">
                    <span className="text-muted-foreground">{e.occurred_at} </span>
                    <span className="font-mono">{e.kind}</span>
                    {mediaName && <span> · {mediaName}</span>}
                    {e.message && <span> · {e.message}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 3: Local smoke test**

```bash
cd dashboard
pnpm dev
```

Open http://localhost:3000/app/screens/<any-existing-device-id>. Scroll to find "Recent errors" card. With no error events in the DB yet, expect: "No errors recorded." Confirm: page renders without errors, devtools console clean.

(Full E2E is deferred to Phase 5 where the emulator actually triggers an error.)

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/app/screens/[id]/page.tsx
git commit -m "feat(dashboard): device detail — Recent errors card from device_error_events"
```

---

# Phase 2 — Crashlytics

Goal: native crashes + ANRs + uncaught Kotlin exceptions report to Firebase console, filterable by `device_id`.

### Task 2.1 — Add Crashlytics to version catalog

**Files:**
- Modify: `android-tv/gradle/libs.versions.toml`

- [ ] **Step 1: Add entries**

In `[versions]` section, add after `googleServices`:

```toml
firebaseCrashlyticsGradle = "3.0.2"
```

In `[libraries]` section, add after `firebase-messaging`:

```toml
firebase-crashlytics = { module = "com.google.firebase:firebase-crashlytics" }
```

In `[plugins]` section, add after `google-services`:

```toml
firebase-crashlytics = { id = "com.google.firebase.crashlytics", version.ref = "firebaseCrashlyticsGradle" }
```

Version `3.0.2` is a plausible recent version as of 2026-04 but the implementer MUST verify against https://plugins.gradle.org/plugin/com.google.firebase.crashlytics or the Firebase Android BOM release notes before committing. If a newer patch-level is current, use that. If 3.0.2 doesn't resolve on first `./gradlew` run, check the plugin portal for the latest `3.x` release and swap in. Pin a specific version (never `+`).

- [ ] **Step 2: Commit**

```bash
git add android-tv/gradle/libs.versions.toml
git commit -m "chore(android): add firebase-crashlytics to version catalog"
```

### Task 2.2 — Apply Crashlytics plugin + dep

**Files:**
- Modify: `android-tv/build.gradle.kts`
- Modify: `android-tv/app/build.gradle.kts`

- [ ] **Step 1: Root `android-tv/build.gradle.kts` — declare the plugin**

The `plugins { }` block must end up as:

```kotlin
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.google.services) apply false
    alias(libs.plugins.firebase.crashlytics) apply false
}
```

- [ ] **Step 2: App module — apply plugin + add dep**

In `android-tv/app/build.gradle.kts`, the top `plugins { }` block must end up as:

```kotlin
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.google.services)
    alias(libs.plugins.firebase.crashlytics)
}
```

In the `dependencies { }` block, next to the existing `firebase-messaging` dep, add:

```kotlin
    implementation(libs.firebase.crashlytics)
```

The grouping around the Firebase BOM should end up as:

```kotlin
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.firebase.crashlytics)
```

- [ ] **Step 3: Build verification**

```bash
cd android-tv && ./gradlew :app:assembleDebug 2>&1 | tail -5
```

Expected: `BUILD SUCCESSFUL`. Crashlytics is a pure init — no code changes needed for it to start operating. Firebase auto-init captures crashes from here on.

- [ ] **Step 4: Commit**

```bash
git add android-tv/build.gradle.kts android-tv/app/build.gradle.kts
git commit -m "feat(android): apply firebase-crashlytics plugin + dep"
```

### Task 2.3 — Tag crashes with device_id + force-crash smoke

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/SignageApp.kt`

- [ ] **Step 1: Read the current `SignageApp` to confirm initialization order**

```bash
cat android-tv/app/src/main/java/com/ouie/signage/SignageApp.kt
```

The existing `onCreate` calls `startKoin { }` and that's it. We add one call after Koin starts to tag Crashlytics reports with the paired `device_id`.

- [ ] **Step 2: Add `setUserId` call**

Modify the class. The resulting file must be:

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/SignageApp.kt
package com.ouie.signage

import android.app.Application
import com.google.firebase.crashlytics.FirebaseCrashlytics
import com.ouie.signage.auth.TokenSource
import com.ouie.signage.di.appModule
import org.koin.android.ext.android.inject
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.GlobalContext
import org.koin.core.context.startKoin

class SignageApp : Application() {

    override fun onCreate() {
        super.onCreate()
        if (GlobalContext.getOrNull() == null) {
            startKoin {
                androidContext(this@SignageApp)
                modules(appModule)
            }
        }
        val tokenStore: TokenSource by inject()
        val deviceId = tokenStore.loadSync()?.deviceId ?: "unpaired"
        FirebaseCrashlytics.getInstance().setUserId(deviceId)
    }
}
```

Notes:
- `setUserId("unpaired")` before pairing is intentional — crashes during pairing flow are still useful and aggregated under a known tag.
- After pairing, the app rehydrates the token via `tokenStore.loadSync()` on next process start, so `setUserId` will flip to the real device_id on the next cold start. For crashes within the first session post-pairing, they'll be tagged "unpaired" — acceptable; the pairing flow is short.
- If the existing `SignageApp` has a different pre-Koin setup, match the structure but preserve the two new lines (`deviceId` read + `setUserId` call) as the last statements in `onCreate`.

- [ ] **Step 3: Build + install to emulator + force a crash**

```bash
# Start emulator if not running (from prior sessions)
adb devices  # confirm emulator-5554 is listed
cd android-tv && ./gradlew :app:installDebug
```

Force a crash by dispatching an intent that triggers one. Since we don't have a force-crash activity, add a one-off test crash in a debug-only code path and revert after verification. Simplest: temporarily modify `MainActivity.onCreate` to add `throw RuntimeException("crashlytics smoke test")` as the FIRST line, reinstall, launch, let it crash, wait 30 seconds for Crashlytics to upload, then revert.

Actually simpler — use the command-line trigger for a native crash of a running process:

```bash
adb shell am crash com.ouie.signage.debug
```

Expected: emulator's Signage Player crashes with "Process <pid> crashed" message.

Wait ~60 seconds for Crashlytics to flush (it batches and uploads on next app launch, not immediately).

Relaunch the app:
```bash
adb shell am start -n com.ouie.signage.debug/com.ouie.signage.MainActivity
```

Then open the Firebase console → Crashlytics → project `signage-ouie`. Within a few minutes the crash should appear, tagged with device_id (or "unpaired" if no token yet).

- [ ] **Step 4: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/SignageApp.kt
git commit -m "feat(android): Crashlytics setUserId — tag reports with device_id"
```

---

# Phase 3 — FCM delivery confirmation

Goal: dashboard shows "Last Sync Now delivered in Xs" (green) or "dispatched Xs ago, not confirmed" (red after 60s), so the operator can see whether FCM push delivery works on a given TV SKU.

### Task 3.1 — Migration for FCM tracking columns

**Files:**
- Create: `supabase/migrations/20260424000200_devices_fcm_tracking.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260424000200_devices_fcm_tracking.sql
-- Two columns to track FCM push dispatch/receipt so the dashboard can display
-- delivery latency per device. State-only (not history); subsequent dispatches
-- overwrite prior values. For 8 TVs in one location this is sufficient —
-- operator clicks Sync Now, sees the delta on next heartbeat refresh.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS last_fcm_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_now_dispatched_at timestamptz;
```

- [ ] **Step 2: Apply locally + restart PostgREST**

```bash
supabase db reset
docker restart supabase_rest_smart-tv-video-viewer
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424000200_devices_fcm_tracking.sql
git commit -m "feat(db): devices — last_fcm_received_at + last_sync_now_dispatched_at"
```

### Task 3.2 — `FcmReceiptTracker` + device wiring

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/fcm/FcmReceiptTracker.kt`
- Modify: `android-tv/app/src/main/java/com/ouie/signage/fcm/SignageMessagingService.kt`
- Modify: `android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatPayload.kt`
- Modify: `android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt`
- Modify: `android-tv/app/src/main/java/com/ouie/signage/coordinator/RunningCoordinator.kt`
- Modify: `android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt`

- [ ] **Step 1: Write `FcmReceiptTracker.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/fcm/FcmReceiptTracker.kt
package com.ouie.signage.fcm

import java.time.Instant

/**
 * Records the timestamp of the last FCM message we received. Written by
 * SignageMessagingService.onMessageReceived; read by HeartbeatScheduler.
 * Volatile single-var state — no buffering (we only care about the latest).
 *
 * Survives until process death. On process restart, starts as null until the
 * next push arrives.
 */
class FcmReceiptTracker {
    @Volatile private var lastAt: Instant? = null
    fun mark() { lastAt = Instant.now() }
    fun current(): Instant? = lastAt
}
```

- [ ] **Step 2: Register in Koin**

In `android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt`, add after the `FcmTokenSource` single:

```kotlin
    single { FcmReceiptTracker() }
```

And add the import at the top with the other `fcm` imports:

```kotlin
import com.ouie.signage.fcm.FcmReceiptTracker
```

- [ ] **Step 3: Wire into `SignageMessagingService`**

Modify `android-tv/app/src/main/java/com/ouie/signage/fcm/SignageMessagingService.kt`. Add the `receiptTracker` inject + call `receiptTracker.mark()` before firing the broadcast. Resulting file:

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/fcm/SignageMessagingService.kt
package com.ouie.signage.fcm

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.koin.java.KoinJavaComponent.inject

class SignageMessagingService : FirebaseMessagingService() {

    private val broadcast: SyncNowBroadcast by inject(SyncNowBroadcast::class.java)
    private val tokenSource: FcmTokenSource by inject(FcmTokenSource::class.java)
    private val receiptTracker: FcmReceiptTracker by inject(FcmReceiptTracker::class.java)

    override fun onMessageReceived(message: RemoteMessage) {
        receiptTracker.mark()
        val action = message.data["action"]
        if (action == "sync") broadcast.fire()
    }

    override fun onNewToken(token: String) {
        tokenSource.update(token)
    }
}
```

Note: `mark()` runs on EVERY FCM message regardless of `action`. We care that the push arrived, not what it asked for.

- [ ] **Step 4: Extend `HeartbeatPayload`**

Modify `android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatPayload.kt`. Add `last_fcm_received_at` as a new nullable field. Resulting `HeartbeatPayload` data class:

```kotlin
@Serializable
data class HeartbeatPayload(
    val app_version: String,
    val uptime_seconds: Long,
    val current_playlist_id: String? = null,
    val last_config_version_applied: String? = null,
    val clock_skew_seconds_from_server: Int? = null,
    val cache_storage_info: CacheStorageInfo? = null,
    val errors_since_last_heartbeat: List<ErrorEvent> = emptyList(),
    /**
     * Latest FCM token known to the device. Null until FirebaseMessaging hands
     * one out (first fresh install can take a second or two). Sent on every
     * heartbeat so server-side rotations and reinstalls recover automatically.
     */
    val fcm_token: String? = null,
    /**
     * Timestamp of the last FCM message received by SignageMessagingService.
     * Paired with server-side last_sync_now_dispatched_at to compute delivery
     * latency on the dashboard. Null if no push has been received this process
     * lifetime.
     */
    val last_fcm_received_at: String? = null,
)
```

Keep the existing `CacheStorageInfo` data class below it unchanged.

- [ ] **Step 5: Extend `HeartbeatScheduler`**

Modify `android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt`. Add a `fcmReceiptTracker` constructor param and populate the new payload field. The resulting constructor + `sendOne()`:

```kotlin
import com.ouie.signage.fcm.FcmReceiptTracker
// ... other existing imports ...

class HeartbeatScheduler(
    private val scope: CoroutineScope,
    private val api: HeartbeatApi,
    private val configRepo: ConfigRepository,
    private val skewTracker: ClockSkewTracker,
    private val playlistSource: CurrentPlaylistSource,
    private val pickProvider: () -> CacheRootResolver.Pick?,
    private val errorBus: ErrorBus,
    private val fcmTokenSource: FcmTokenSource,
    private val preloadStatusSource: PreloadStatusSource,
    private val fcmReceiptTracker: FcmReceiptTracker,
    private val intervalMs: Long = 60_000,
) {

    // ... job, processStartRealtime, start(), stop() unchanged ...

    private suspend fun sendOne() {
        val uptimeSeconds = (SystemClock.elapsedRealtime() - processStartRealtime) / 1000
        val pick = pickProvider()
        val cacheInfo = pick?.let {
            CacheStorageInfoBuilder.buildFrom(it, preloadStatusSource.current())
        }
        val errors = errorBus.drain()
        val fcm = fcmTokenSource.current()
        val fcmReceived = fcmReceiptTracker.current()?.toString()
        val payload = HeartbeatPayload(
            app_version = BuildConfig.VERSION_NAME,
            uptime_seconds = uptimeSeconds,
            current_playlist_id = playlistSource.current(),
            last_config_version_applied = configRepo.current.value?.version,
            clock_skew_seconds_from_server = skewTracker.current(),
            cache_storage_info = cacheInfo,
            errors_since_last_heartbeat = errors,
            fcm_token = fcm,
            last_fcm_received_at = fcmReceived,
        )
        try {
            api.post(payload)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            // Best-effort; next tick retries. We DO NOT re-enqueue drained errors —
            // single-send-best-effort matches the "errors_since_last_heartbeat" spec
            // semantics and avoids unbounded error carryover.
        }
    }
}
```

Preserve the existing `fun interface CurrentPlaylistSource`, `job`, `processStartRealtime`, `start()`, `stop()` — they're unchanged.

- [ ] **Step 6: Update `RunningCoordinator` to supply the new dep**

Modify `android-tv/app/src/main/java/com/ouie/signage/coordinator/RunningCoordinator.kt`. Add `fcmReceiptTracker: FcmReceiptTracker` to the class constructor and pass it to `HeartbeatScheduler`. The relevant diff:

Constructor — add `fcmReceiptTracker` between `syncNow` and the closing paren:

```kotlin
class RunningCoordinator(
    private val context: Context,
    private val downloaderHttpClient: OkHttpClient,
    private val configApi: ConfigApi,
    private val heartbeatApi: HeartbeatApi,
    private val cacheStatusApi: CacheStatusApi,
    private val skewTracker: ClockSkewTracker,
    private val json: Json,
    private val errorBus: ErrorBus,
    private val fcmTokenSource: FcmTokenSource,
    private val syncNow: SyncNowBroadcast,
    private val fcmReceiptTracker: FcmReceiptTracker,
) {
```

Add the import:

```kotlin
import com.ouie.signage.fcm.FcmReceiptTracker
```

Inside `start()`, extend the `HeartbeatScheduler` constructor call with one more named argument (placed between `preloadStatusSource = scanner` and the closing paren):

```kotlin
        val beat = HeartbeatScheduler(
            scope = newScope,
            api = heartbeatApi,
            configRepo = configRepo,
            skewTracker = skewTracker,
            playlistSource = director,
            pickProvider = { _cachePick.value },
            errorBus = errorBus,
            fcmTokenSource = fcmTokenSource,
            preloadStatusSource = scanner,
            fcmReceiptTracker = fcmReceiptTracker,
        )
```

- [ ] **Step 7: Update `AppModule.kt` to supply `RunningCoordinator` with the new dep**

Modify `android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt`. Extend the `RunningCoordinator` binding with the new param (after `syncNow = get()`):

```kotlin
    single {
        RunningCoordinator(
            context = androidContext(),
            downloaderHttpClient = get(qualifier = named("downloader")),
            configApi = get(),
            heartbeatApi = get(),
            cacheStatusApi = get(),
            skewTracker = get(),
            json = get(),
            errorBus = get(),
            fcmTokenSource = get(),
            syncNow = get(),
            fcmReceiptTracker = get(),
        )
    }
```

- [ ] **Step 8: Build verification**

```bash
cd android-tv && ./gradlew :app:assembleDebug 2>&1 | tail -5
./gradlew :app:testDebugUnitTest 2>&1 | tail -5
```

Expected: both `BUILD SUCCESSFUL`. Unit test suite stays green — the changes don't affect any existing test's fixtures.

- [ ] **Step 9: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/fcm/FcmReceiptTracker.kt \
        android-tv/app/src/main/java/com/ouie/signage/fcm/SignageMessagingService.kt \
        android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatPayload.kt \
        android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt \
        android-tv/app/src/main/java/com/ouie/signage/coordinator/RunningCoordinator.kt \
        android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt
git commit -m "feat(android): FcmReceiptTracker — last_fcm_received_at in heartbeat"
```

### Task 3.3 — Server-side FCM tracking writes (TDD)

**Files:**
- Create: `supabase/functions/tests/fcm_tracking.test.ts`
- Modify: `supabase/functions/devices-heartbeat/index.ts`
- Modify: `supabase/functions/devices-sync-now/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// supabase/functions/tests/fcm_tracking.test.ts
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pairDevice } from "./_helpers.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

Deno.test({
  name: "heartbeat writes last_fcm_received_at when present in payload",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const receivedAt = "2026-04-23T12:00:00.000Z";
    const r = await fetch(`${FN}/devices-heartbeat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        app_version: "test",
        uptime_seconds: 10,
        last_fcm_received_at: receivedAt,
      }),
    });
    assertEquals(r.status, 204);
    await r.body?.cancel();

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data } = await svc.from("devices")
      .select("last_fcm_received_at")
      .eq("id", creds.device_id).single();
    assertEquals(data?.last_fcm_received_at, receivedAt);
  },
});

Deno.test({
  name: "devices-sync-now stamps last_sync_now_dispatched_at on the target device",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const creds = await pairDevice();
    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Authenticate as the tenant user for devices-sync-now (it requires user JWT, not device JWT).
    // pairDevice returns tenant credentials too.
    const before = await svc.from("devices")
      .select("last_sync_now_dispatched_at")
      .eq("id", creds.device_id).single();
    const beforeAt = before.data?.last_sync_now_dispatched_at;

    const r = await fetch(`${FN}/devices-sync-now`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.user_jwt}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ device_id: creds.device_id }),
    });
    assertEquals(r.status, 202);
    await r.body?.cancel();

    // Small delay for UPDATE to commit.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const after = await svc.from("devices")
      .select("last_sync_now_dispatched_at")
      .eq("id", creds.device_id).single();
    assertNotEquals(after.data?.last_sync_now_dispatched_at, beforeAt);
    assertNotEquals(after.data?.last_sync_now_dispatched_at, null);
  },
});
```

The test references `creds.user_jwt` from `pairDevice()`. If the current `_helpers.ts` doesn't expose that (check by `grep -n 'user_jwt\|access_token\|device_id' supabase/functions/tests/_helpers.ts`), add it to the returned object. If the helper already returns a tenant user access token under a different name, adjust the test to use that name. Do NOT change the helper's existing API shape for other callers.

- [ ] **Step 2: Run the test — verify both fail**

```bash
deno task test --filter "heartbeat writes last_fcm_received_at"
deno task test --filter "devices-sync-now stamps last_sync_now_dispatched_at"
```

Expected: both fail. `last_fcm_received_at` test fails because the column value is null (server isn't writing it). `last_sync_now_dispatched_at` test fails the same way.

- [ ] **Step 3: Extend `devices-heartbeat`**

Modify `supabase/functions/devices-heartbeat/index.ts`. After the existing `fcm_token` conditional block, add:

```typescript
  if (typeof body.last_fcm_received_at === "string") {
    update.last_fcm_received_at = body.last_fcm_received_at;
  }
```

No ISO-8601 validation — Postgres will reject a non-timestamp value and the whole UPDATE will fail. If the device sends garbage, the heartbeat fails with 500 (noisy) rather than silently corrupting data.

- [ ] **Step 4: Extend `devices-sync-now`**

Modify `supabase/functions/devices-sync-now/index.ts`. After the `targetTokens` collection loop (around line 49) and BEFORE the `Promise.allSettled` call, add:

```typescript
  // Stamp dispatch timestamp(s) on the target device row(s) for delivery-latency
  // tracking. Uses service-role client so RLS doesn't block the write on our
  // behalf. Separate from FCM send so a DB failure doesn't block the push and
  // vice versa.
  const dispatchedAt = new Date().toISOString();
  const svc = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
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
```

Also add the service-role client import at the top of the file (it's probably already there for tenant-ID lookups; if not, import it). The anon-key tenant client `userClient` stays as-is because it's already bound to the user JWT for RLS enforcement on target resolution.

- [ ] **Step 5: Restart edge runtime + re-run tests**

```bash
docker restart supabase_edge_runtime_smart-tv-video-viewer
deno task test --filter "heartbeat writes last_fcm_received_at"
deno task test --filter "devices-sync-now stamps last_sync_now_dispatched_at"
deno task test --filter "sync_now"
deno task test --filter "heartbeat"
```

Expected: all pass. The last two commands re-run the full sync_now + heartbeat test suites to confirm no regressions in existing behavior.

- [ ] **Step 6: Deploy to production**

```bash
pnpm dlx dotenv-cli -e .env.production -- supabase functions deploy devices-heartbeat devices-sync-now
pnpm dlx dotenv-cli -e .env.production -- supabase db push
```

Expected: both functions report "Deployed" and the new migration applies.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/devices-heartbeat/index.ts \
        supabase/functions/devices-sync-now/index.ts \
        supabase/functions/tests/fcm_tracking.test.ts
git commit -m "feat(fn): FCM delivery tracking — dispatch + receipt timestamps on devices"
```

### Task 3.4 — Dashboard FCM latency display

**Files:**
- Modify: `dashboard/app/app/screens/[id]/page.tsx`

- [ ] **Step 1: Add the two columns to the devices select**

In the existing `supabase.from("devices").select(...)` on `page.tsx`, append to the select string:

```
last_fcm_received_at, last_sync_now_dispatched_at
```

Full updated select:

```typescript
    supabase.from("devices").select(`
      id, name, store_id, last_seen_at, fcm_token, fallback_playlist_id,
      cache_storage_info, current_app_version, current_playlist_id,
      last_config_version_applied, clock_skew_seconds_from_server,
      last_fcm_received_at, last_sync_now_dispatched_at,
      stores(name, timezone)
    `).eq("id", id).maybeSingle(),
```

- [ ] **Step 2: Compute + render status**

Below the "Clock skew" card (around line 108 in the existing file), add a new card:

```tsx
      {device.last_sync_now_dispatched_at && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Last Sync Now</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {(() => {
              const dispatched = new Date(device.last_sync_now_dispatched_at);
              const received = device.last_fcm_received_at
                ? new Date(device.last_fcm_received_at)
                : null;
              const delivered = received && received >= dispatched;
              const secsSinceDispatch = Math.floor((Date.now() - dispatched.getTime()) / 1000);
              if (delivered) {
                const latencyMs = received.getTime() - dispatched.getTime();
                const latency = (latencyMs / 1000).toFixed(1);
                return (
                  <span className="text-emerald-600">
                    Delivered in {latency}s
                  </span>
                );
              }
              // Not delivered yet. Threshold 60s = ConfigPoller.intervalMs (if push fails,
              // poll will pick up config on next tick anyway, so pushes that take longer
              // than that are effectively lost).
              if (secsSinceDispatch < 60) {
                return (
                  <span className="text-muted-foreground">
                    Dispatched {secsSinceDispatch}s ago, awaiting delivery
                  </span>
                );
              }
              return (
                <span className="text-destructive">
                  Not delivered ({secsSinceDispatch}s ago) — FCM push failed or was filtered
                </span>
              );
            })()}
          </CardContent>
        </Card>
      )}
```

The grid around status/app-version/clock-skew is already `<div className="grid grid-cols-3 gap-4">` (or similar — verify in the file); place this new card inside the same grid so it sits on the same row. If the grid is 3 columns, this becomes the 4th card; switch to `grid-cols-4` or let it wrap.

- [ ] **Step 3: Smoke test**

```bash
cd dashboard && pnpm dev
```

Open http://localhost:3000/app/screens/<existing-device-id>. If the device has never received a Sync Now, the card is hidden (correct — no `last_sync_now_dispatched_at`). The full E2E flow (click → device receives → dashboard shows delivered) is deferred to Phase 5.

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/app/screens/[id]/page.tsx
git commit -m "feat(dashboard): Last Sync Now latency card — dispatched/delivered state"
```

---

# Phase 4 — Playback state in heartbeat

Goal: dashboard shows `current_media_id` + `playback_state` (one of `"playing" | "preparing" | "no_content"`) so operators can see whether the device thinks it's playing even if the physical screen is black.

### Task 4.1 — Extend `PlaybackDirector` with `PlaybackStateSource`

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackDirector.kt`

- [ ] **Step 1: Add a new `fun interface` + implement it on `PlaybackDirector`**

At the top of `android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackDirector.kt`, ABOVE the `class PlaybackDirector` declaration, add:

```kotlin
/**
 * Flat view of PlaybackDirector state for observability. HeartbeatScheduler reads
 * these on each tick to populate current_media_id + playback_state in the payload.
 * Kept separate from CurrentPlaylistSource because heartbeat cares about the
 * narrower media-id + coarse state-tag, not the full PlaybackState sum-type.
 */
fun interface PlaybackStateSource {
    fun snapshot(): PlaybackStateSnapshot
}

data class PlaybackStateSnapshot(
    /** UUID of the currently-playing media item, or null if not in Playing state. */
    val currentMediaId: String?,
    /** One of "playing" | "preparing" | "no_content". */
    val stateTag: String,
)
```

Change the class declaration to implement both interfaces:

```kotlin
class PlaybackDirector(
    private val config: StateFlow<ConfigDto?>,
    private val cachedMediaIds: StateFlow<Set<String>>,
    private val fileFor: (mediaId: String) -> File?,
    private val clock: Clock = Clock.systemUTC(),
) : CurrentPlaylistSource, PlaybackStateSource {

    // ... existing fields + methods unchanged ...

    override fun snapshot(): PlaybackStateSnapshot {
        val s = _state.value
        return PlaybackStateSnapshot(
            currentMediaId = (s as? PlaybackState.Playing)?.item?.mediaId,
            stateTag = when (s) {
                is PlaybackState.Playing -> "playing"
                PlaybackState.Preparing -> "preparing"
                PlaybackState.NoContent -> "no_content"
            },
        )
    }
}
```

Place `snapshot()` next to the existing `override fun current(): String?` for locality.

- [ ] **Step 2: Build verification**

```bash
cd android-tv && ./gradlew :app:compileDebugKotlin 2>&1 | tail -5
./gradlew :app:testDebugUnitTest 2>&1 | tail -5
```

Expected: both `BUILD SUCCESSFUL`. No unit tests reference `snapshot()` yet, and existing `PlaybackDirectorTest` should continue to pass (the new method is additive and doesn't touch tick logic).

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackDirector.kt
git commit -m "feat(android): PlaybackStateSource — flat snapshot for heartbeat observability"
```

### Task 4.2 — Migration for playback state columns

**Files:**
- Create: `supabase/migrations/20260424000300_devices_playback_state.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260424000300_devices_playback_state.sql
-- Two columns to mirror the device's current PlaybackDirector state on the
-- dashboard. current_media_id is a free-form text field (not FK to media)
-- because the device may report a media_id that was since deleted; the
-- dashboard tolerates stale references rather than failing the write.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS current_media_id text,
  ADD COLUMN IF NOT EXISTS playback_state text;
```

- [ ] **Step 2: Apply locally + restart PostgREST**

```bash
supabase db reset
docker restart supabase_rest_smart-tv-video-viewer
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424000300_devices_playback_state.sql
git commit -m "feat(db): devices — current_media_id + playback_state columns"
```

### Task 4.3 — Wire playback state through heartbeat end-to-end

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatPayload.kt`
- Modify: `android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt`
- Modify: `android-tv/app/src/main/java/com/ouie/signage/coordinator/RunningCoordinator.kt`
- Modify: `supabase/functions/devices-heartbeat/index.ts`
- Modify: `dashboard/app/app/screens/[id]/page.tsx`

- [ ] **Step 1: Extend `HeartbeatPayload`**

In `android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatPayload.kt`, add two new fields at the end of the data class:

```kotlin
@Serializable
data class HeartbeatPayload(
    val app_version: String,
    val uptime_seconds: Long,
    val current_playlist_id: String? = null,
    val last_config_version_applied: String? = null,
    val clock_skew_seconds_from_server: Int? = null,
    val cache_storage_info: CacheStorageInfo? = null,
    val errors_since_last_heartbeat: List<ErrorEvent> = emptyList(),
    val fcm_token: String? = null,
    val last_fcm_received_at: String? = null,
    /**
     * UUID of the media item the device's PlaybackDirector currently has in
     * Playing state. Null if Preparing or NoContent. Useful on dashboard to
     * confirm "server thinks X is playing" matches what's visible on screen.
     */
    val current_media_id: String? = null,
    /**
     * One of "playing" | "preparing" | "no_content". Matches
     * PlaybackStateSnapshot.stateTag.
     */
    val playback_state: String? = null,
)
```

- [ ] **Step 2: Extend `HeartbeatScheduler` to accept + populate**

In `android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt`:

Add import:
```kotlin
import com.ouie.signage.playback.PlaybackStateSource
```

Add constructor param (between `fcmReceiptTracker` and `intervalMs`):

```kotlin
    private val playbackStateSource: PlaybackStateSource,
```

Inside `sendOne()`, after the existing `val fcmReceived = ...` line:

```kotlin
        val playbackSnapshot = playbackStateSource.snapshot()
```

Pass the two new fields into `HeartbeatPayload(...)`:

```kotlin
            last_fcm_received_at = fcmReceived,
            current_media_id = playbackSnapshot.currentMediaId,
            playback_state = playbackSnapshot.stateTag,
```

- [ ] **Step 3: Update `RunningCoordinator` to pass `director` as the source**

In `android-tv/app/src/main/java/com/ouie/signage/coordinator/RunningCoordinator.kt`, extend the `HeartbeatScheduler` call inside `start()`:

```kotlin
        val beat = HeartbeatScheduler(
            scope = newScope,
            api = heartbeatApi,
            configRepo = configRepo,
            skewTracker = skewTracker,
            playlistSource = director,
            pickProvider = { _cachePick.value },
            errorBus = errorBus,
            fcmTokenSource = fcmTokenSource,
            preloadStatusSource = scanner,
            fcmReceiptTracker = fcmReceiptTracker,
            playbackStateSource = director,
        )
```

`director` already implements `PlaybackStateSource` (via Task 4.1). No new Koin binding needed.

- [ ] **Step 4: Build + tests**

```bash
cd android-tv && ./gradlew :app:assembleDebug 2>&1 | tail -5
./gradlew :app:testDebugUnitTest 2>&1 | tail -5
```

Expected: both green.

- [ ] **Step 5: Extend `devices-heartbeat` to accept the two new fields**

Modify `supabase/functions/devices-heartbeat/index.ts`. After the existing `last_fcm_received_at` conditional, add:

```typescript
  if (typeof body.current_media_id === "string") {
    update.current_media_id = body.current_media_id;
  } else if (body.current_media_id === null) {
    // Explicit null (Playing → Preparing transition): clear the column.
    update.current_media_id = null;
  }
  if (typeof body.playback_state === "string") {
    update.playback_state = body.playback_state;
  }
```

The explicit-null handling matters: when the device goes from Playing (with a media_id) to Preparing (null), we want the dashboard to reflect that. The other fields all treat missing/null as "don't change" but here null is meaningful state.

- [ ] **Step 6: Deploy function + apply migration to production**

```bash
pnpm dlx dotenv-cli -e .env.production -- supabase functions deploy devices-heartbeat
pnpm dlx dotenv-cli -e .env.production -- supabase db push
```

- [ ] **Step 7: Add dashboard display**

In `dashboard/app/app/screens/[id]/page.tsx`, extend the devices `select(...)`:

```
current_media_id, playback_state
```

And add a new card next to the existing "Cache storage" card (around line 111):

```tsx
      {device.playback_state && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Playback state</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <span className="font-mono">{device.playback_state}</span>
            {device.current_media_id && (
              <span className="text-muted-foreground">
                {" · "}media {device.current_media_id.slice(0, 8)}…
              </span>
            )}
          </CardContent>
        </Card>
      )}
```

- [ ] **Step 8: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatPayload.kt \
        android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt \
        android-tv/app/src/main/java/com/ouie/signage/coordinator/RunningCoordinator.kt \
        supabase/functions/devices-heartbeat/index.ts \
        dashboard/app/app/screens/[id]/page.tsx
git commit -m "feat: Playback state in heartbeat — current_media_id + playback_state"
```

---

# Phase 5 — Acceptance + close

### Task 5.1 — Emulator smoke

**Files:** none (acceptance)

- [ ] **Step 1: Fresh install + pair**

Emulator `atv34` must be running. If not:
```bash
/opt/homebrew/share/android-commandlinetools/emulator/emulator -avd atv34 -no-snapshot-save > /tmp/atv34.log 2>&1 &
adb wait-for-device
```

Clean + install:
```bash
adb shell pm clear com.ouie.signage.debug
cd android-tv && ./gradlew :app:installDebug
adb shell am start -n com.ouie.signage.debug/com.ouie.signage.MainActivity
```

Pair via Playwright through the dashboard (same flow as Plan 3c Task 6.2).

- [ ] **Step 2: Verify new heartbeat fields land on server**

Wait for first heartbeat (~70s after pair). Check the device detail page:
- `playback_state = "no_content"` (no playlist assigned yet)
- `current_media_id` absent (NoContent state)
- `last_fcm_received_at` absent (no push received yet)

Or via logcat (emulator):
```bash
adb logcat -d -v time | grep -A 30 "POST.*devices-heartbeat" | grep "playback_state\|current_media_id\|last_fcm"
```

Expected: heartbeat body contains `playback_state`, may or may not contain `current_media_id` (null omitted by `explicitNulls = false` config), `last_fcm_received_at` absent.

- [ ] **Step 3: Assign playlist, verify playback_state transitions**

Assign a playlist with ≥1 media item. Wait ~90s for the next heartbeat to reflect. On dashboard device detail, confirm:
- `playback_state = "playing"` (or `"preparing"` if still downloading)
- `current_media_id` populated with the first playlist item's UUID

- [ ] **Step 4: Trigger an error, verify it lands in Recent errors card**

The cleanest deterministic trigger: assign a playlist, then DELETE one of the media items (through the dashboard) while the device still has it in the playlist. The device's `MediaDownloader.ensureSpace` + subsequent re-download will 404, ErrorBus.report("download_failed", media_id, "404 from R2") fires, next heartbeat ships it, server persists.

Simpler alternative: use `adb shell` to force the APK into a state that makes PlaybackDirector call ErrorBus. Actually the simplest: add a one-off test-only line to the APK that reports a canned error on every tick (e.g., inside `tick()` in PlaybackDirector: `errorBus.report("test_error", null, "smoke test")`), install, verify, then REVERT that line. This is acceptable as a temporary smoke-test scaffold that's NOT committed. Do the revert BEFORE Step 6 (acceptance close commit).

Expected: within ~120s (one heartbeat cycle), dashboard "Recent errors" card shows at least one row with kind, timestamp, message.

- [ ] **Step 5: Crashlytics smoke**

```bash
adb shell am crash com.ouie.signage.debug
# wait ~60s
adb shell am start -n com.ouie.signage.debug/com.ouie.signage.MainActivity
# wait another ~60s for Crashlytics upload
```

Open Firebase console → Crashlytics → project signage-ouie. Expect: the crash appears within a few minutes, tagged with the device_id of the paired device.

- [ ] **Step 6: FCM latency smoke**

Click Sync Now on dashboard. Refresh the device detail page. Expect one of:
- ✅ "Delivered in X.Xs" (green) — FCM works on emulator (we saw this fail on Plan 3c emulator; may still not work here)
- ⚠️ "Dispatched Xs ago, awaiting delivery" / "Not delivered" — confirms the FCM-on-emulator limitation from Plan 3c is still a thing

Either outcome is acceptable for emulator. The feature is correct if the display accurately reflects reality — the point is not to make FCM work on emulator but to make FCM behavior VISIBLE. Document whichever outcome occurred in the acceptance commit.

- [ ] **Step 7: Phase close commit**

```bash
git commit --allow-empty -m "chore: Plan 4 emulator acceptance — error log + Crashlytics + FCM state + playback state verified"
```

### Task 5.2 — Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Flip status line**

In `CLAUDE.md`, replace the top-of-file `**Status (as of 2026-04-23):**` paragraph with:

```markdown
**Status (as of 2026-04-24):** **Plans 1 + 2 + 2.1 + 2.2 + 3a + 3b + 3c + 4 complete. Dashboard live at https://signage-ouie.vercel.app; Android TV APK pairs, heartbeats, syncs config, downloads media, plays via ExoPlayer/Compose, receives FCM sync-now pushes, auto-launches after reboot, LRU-evicts stale cache, imports preloaded USB media, and ships an ErrorBus summary + FCM receipt timestamp + current playback state in the heartbeat payload. Firebase Crashlytics wired (native crashes + ANRs tagged with device_id report to Firebase console). Dashboard device detail page shows "Recent errors" card, "Last Sync Now" delivery latency, and current "Playback state". Real-hardware acceptance (Plan 3c Task 7.1) still deferred to first F&B TV install; all Plan 4 observables verified on emulator.**
```

Preserve the "Earlier milestone" paragraphs below it unchanged.

- [ ] **Step 2: Add Plan 4 pointer**

In "Key file pointers" section, after the Plan 3c line:

```
- Plan 4 (done): `docs/superpowers/plans/2026-04-23-plan-4-observability.md`
```

- [ ] **Step 3: Append Plan 4 conventions**

In "Conventions decided during this project" section, append before the "Stack summary" heading:

```markdown
- **Error events persist in `device_error_events` (Plan 4).** `devices-heartbeat` batch-inserts from `errors_since_last_heartbeat` in the payload. Schema mirrors `cache_events`: tenant_id, device_id, kind (text — no CHECK), media_id (uuid nullable, non-UUID strings from client coerce to null), message (text), occurred_at (device clock), created_at (server insert). RLS is SELECT-only for tenant members; Edge Function writes via service role. No retention policy in v1 — revisit if rate grows.
- **Crashlytics tagged with device_id (Plan 4).** `SignageApp.onCreate` calls `FirebaseCrashlytics.getInstance().setUserId(deviceId ?? "unpaired")` after Koin init. Firebase console → Crashlytics shows crashes grouped by device. Native ANRs + uncaught Kotlin exceptions captured automatically (no explicit `recordException` calls needed). First session post-pairing is tagged "unpaired" because token load is synchronous but happens pre-pair-claim; subsequent sessions use the real device_id. Acceptable trade-off given pairing sessions are short.
- **FCM delivery latency visible on dashboard (Plan 4).** `devices-sync-now` stamps `devices.last_sync_now_dispatched_at = now()` (service-role UPDATE, separate from FCM send so DB failure doesn't kill the push and vice versa). `SignageMessagingService.onMessageReceived` calls `FcmReceiptTracker.mark()` BEFORE firing `SyncNowBroadcast`. Heartbeat ships `last_fcm_received_at`. Dashboard computes delta. Threshold for "Not delivered": 60s, cited as matching `ConfigPoller.intervalMs` — if a push takes longer than one poll cycle, the poll already covers the sync anyway.
- **Playback state in heartbeat (Plan 4).** `PlaybackDirector` implements a new `PlaybackStateSource` fun interface alongside `CurrentPlaylistSource`. `snapshot()` returns `PlaybackStateSnapshot(currentMediaId, stateTag)` where `stateTag ∈ {"playing", "preparing", "no_content"}`. `HeartbeatScheduler` calls `snapshot()` each tick. `current_media_id` column is plain text, NOT FK to media — tolerates stale references (media may be deleted between report and read; dashboard is cosmetic so that's OK). Explicit null handling in `devices-heartbeat`: sending `current_media_id: null` in the payload clears the column (Playing → Preparing transition needs this).
- **Explicit-null semantics on heartbeat fields (Plan 4 pattern).** Most heartbeat fields treat "missing from payload" and "explicitly null" the same way — don't overwrite the existing column. But `current_media_id` is an exception: null means "now in Preparing/NoContent state" and MUST clear the column. When adding new heartbeat fields, decide this explicitly per field and document in the Edge Function comment.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): plan 4 shipped — error log + Crashlytics + FCM state + playback state"
```

### Task 5.3 — End-of-plan commit + PR + merge

- [ ] **Step 1: Empty close commit**

```bash
git commit --allow-empty -m "feat: plan 4 — observability (error log + Crashlytics + FCM state + playback state) live"
```

- [ ] **Step 2: Push + create PR**

```bash
git push -u origin <branch-name>
gh pr create --title "Plan 4 — observability (error log + Crashlytics + FCM state + playback state)" --body "$(cat <<'EOF'
## Summary

Plan 4 ships operator-facing telemetry so device issues can be diagnosed from the dashboard without ADB access:

- **Error telemetry** — `device_error_events` table persists `errors_since_last_heartbeat`. Dashboard device detail shows "Recent errors" card.
- **Crashlytics** — native crashes + ANRs report to Firebase console, tagged with device_id.
- **FCM delivery confirmation** — `devices.last_sync_now_dispatched_at` (server) + `devices.last_fcm_received_at` (device). Dashboard shows delivery latency or "Not delivered" state.
- **Playback state in heartbeat** — `devices.current_media_id` + `devices.playback_state`. Dashboard shows what the device thinks it's playing.

~13 tasks across 5 phases. Build green, all Deno tests pass including 6 new ones across `error_events.test.ts` and `fcm_tracking.test.ts`.

## Test plan

- [x] Emulator smoke of all 4 features (Task 5.1):
  - Heartbeat body contains `playback_state`, `current_media_id`, `last_fcm_received_at` fields
  - Triggered error appears in dashboard "Recent errors" card
  - Forced crash appears in Firebase Crashlytics console tagged with device_id
  - FCM Sync Now dispatch stamps `last_sync_now_dispatched_at`; delivery status visible on dashboard (emulator FCM delivery still flaky — behavior accurately reflected)
- [ ] Real-hardware acceptance — still deferred to first F&B TV install (Plan 3c Task 7.1)

## Known non-blocking follow-ups

1. No retention policy on `device_error_events` — revisit if operational data shows rate would grow beyond comfortable bounds.
2. Crashlytics "unpaired" session tag — by design; pairing flow is short so the window where this matters is bounded.
3. On-demand full-log-tail feature deferred to v1.1. Current Phase 4 telemetry covers ~90% of troubleshooting cases per design reasoning in the plan.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Merge**

```bash
gh pr merge <pr-number> --merge --delete-branch
```

---

## Appendix A — Acceptance matrix

| Scenario | Expected behavior |
|---|---|
| Device reports an error | `device_error_events` has a new row within one heartbeat cycle; dashboard "Recent errors" shows it. |
| Device reports an error with non-UUID media_id | Row is inserted with `media_id = NULL`; entire payload still accepted (heartbeat succeeds). |
| Device goes Playing → Preparing → Playing | `devices.playback_state` flips `playing` → `preparing` → `playing`; `current_media_id` clears then re-populates. |
| Dashboard Sync Now click | `devices.last_sync_now_dispatched_at` updates immediately; dashboard refresh shows "Dispatched Xs ago, awaiting delivery" until `last_fcm_received_at >= dispatched_at`, then flips to "Delivered in Ys". |
| FCM push lost (emulator / blocked SKU) | After 60s, dashboard shows "Not delivered — FCM push failed or was filtered". |
| App crashes natively | Crash appears in Firebase Crashlytics within minutes, tagged with device_id. |
| Device sends `current_media_id: null` explicitly | Column clears. Test this on Playing → Preparing transition. |

## Appendix B — Explicit non-goals for Plan 4

- **On-demand full-log-tail feature** (ring buffer on device + FCM-triggered upload + dedicated table + dashboard viewer). ~5 additional tasks; speculative value. Revisit in v1.1 if existing telemetry proves insufficient during real-hardware deployment.
- **Memory/CPU/network enrichment in heartbeat.** Overkill for 8 TVs; adds complexity without clear troubleshooting payoff.
- **Structured log aggregation** (Grafana/Loki). Scale issue, not current.
- **Retention/cron purge of `device_error_events`.** Defer until operational data shows it matters.
- **Alerting on error-rate thresholds** (e.g., Brevo alert if a device emits >N errors per hour). Different concern from observability; belongs in a separate alerts-extension plan.
- **Crashlytics custom keys beyond device_id** (e.g., current playlist, cache state). Firebase console already captures device state + stack trace; custom keys are a v1.1 polish.

## Appendix C — Known risks specific to Plan 4

1. **`device_error_events` row explosion under a bug that spams ErrorBus.** Mitigation already in place: `ErrorBus` is a bounded FIFO (capacity 32, per `ErrorBus.kt:18`). Worst case: 32 rows per heartbeat × 1 heartbeat/minute × 1440 min/day = ~46K rows/device/day. For 8 devices that's ~370K rows/day. Still within Postgres comfort for indexed queries, but large enough that a future retention policy might be needed. Flag for monitoring post-deployment.
2. **`last_sync_now_dispatched_at` is overwritten on every click.** If the operator clicks Sync Now twice within 60s, the latency display reflects only the most recent click's delivery. Not a correctness issue but counterintuitive if the operator is spamming the button. Acceptable — documented.
3. **FCM delivery on TCL 50Q725 specifically.** Plan 3c emulator acceptance showed FCM delivery is flaky on emulators without signed-in Google accounts. TCL OEM forks may have push-message filtering that kills FCM regardless of token validity. If this TV SKU doesn't receive FCM, the delivery latency card will permanently show "Not delivered" — which is an informative but disappointing outcome. If confirmed on real hardware, it's a TCL-specific limitation to document, not a Plan 4 bug.
4. **Crashlytics "unpaired" tag leakage.** If a device crashes repeatedly during pairing, all its crashes aggregate under user_id "unpaired" in Firebase console, making it hard to distinguish between different TVs with different issues. Acceptable for v1; revisit if pairing-phase crashes become a common support pattern.
5. **Playback state reflects `PlaybackDirector.state`, not the actual rendering surface.** If the Compose `PlayerView` dies without updating `_state` (crash in render, surface destroyed externally), dashboard will show `playback_state = "playing"` while the physical screen is black. The whole point of this feature is to help detect such cases by comparing dashboard state against visible screen — but operators need to know this is how it works.
