# Plan 5 — OTA Updates + Cosmetic Polish + FCM Post-Reboot Mitigation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the per-update USB-sideload tax by shipping in-app OTA APK updates via R2 + PackageInstaller; replace the placeholder branding (slate rectangle banner, no app icon, no splash) with the Ouie wordmark + circle logo across Leanback launcher, app icon, and Android 12+ SplashScreen; add a no-diagnostics-needed FCM post-reboot mitigation (force token refresh on first heartbeat after boot) plus server-side FCM dispatch outcome capture so the dashboard can distinguish "FCM rejected our send" from "FCM accepted but device never received."

**Architecture:**
- **OTA:** Single-row pointer per tenant — `tenants.latest_apk_*` columns store version_code, version_name, R2 path, sha256, released_at. Dashboard "App Releases" page uploads the APK via the same two-phase R2 presigned-PUT pattern as media uploads (`apk-upload-url` → R2 → `apk-publish` finalizes the row with monotonic version_code enforcement). `devices-config` includes an `app_release` block with a freshly presigned 24h GET URL. Device-side `UpdateChecker` (Koin single, started by `RunningCoordinator`) sees the block on every config refresh, downloads to `<cache_root>/updates/<version_code>.apk` if `version_code > BuildConfig.VERSION_CODE`, verifies sha256, then fires the `PackageInstaller` session API. The user sees the system "Install update?" dialog (remote-navigable) and confirms. App restarts automatically; `SignageService` `START_STICKY` handles re-launch of the headless service.
- **Cosmetic polish:** Multi-density PNGs generated from the source logos at build-prep time (committed to repo, not generated during build). Wordmark logo (`ouie logo.png`, 3.18:1) → centered white wordmark on brand-green `#008058` background → drawables at xhdpi/xxhdpi/xxxhdpi for the Leanback banner. Circle logo (`ouie circle logo.png`) → adaptive icon split (background = solid `#008058`, foreground = the white "Ouie!" wordmark extracted from the circle) for Android 8+ adaptive icons; legacy mipmap PNGs at five densities for older launchers. Android 12+ SplashScreen API takes the same foreground icon over a brand-green window background; pre-12 falls back automatically via the AndroidX SplashScreen compat shim. New `InitialSyncOverlay` composable on `RunningScreen` shows the brand mark + spinner + "Syncing menu..." until first media file lands in the cache.
- **FCM mitigation:** `FcmTokenSource.forceRefresh()` calls `FirebaseMessaging.getInstance().deleteToken().await()` then `getToken().await()` — observation-poor but exercises the GMS path end-to-end; if the issue is socket-staleness this fixes it, if not we know more. `HeartbeatScheduler` tracks a boolean `firstAfterBoot` (true at construction, false after first send) and triggers `forceRefresh` before the first sendOne() call. Server-side: `devices-sync-now` captures the FCM HTTP v1 response (messageId on success, error.status + error.message on failure) and stamps `devices.last_fcm_dispatch_*` columns. Dashboard FCM card on device detail shows dispatch outcome alongside existing `last_fcm_received_at` so a missing receipt can be triaged (FCM rejected → server-side fix; FCM accepted but no receipt → device-side socket).

**Tech Stack:** Kotlin 2.1.0 / AGP 8.7.2 / compileSdk 35 / minSdk 26 / Android Gradle / Compose-for-TV Material3 1.0.0 / Media3 1.5.1 / Firebase BoM 33.5.1 / OkHttp 4.12.0 / Koin 4.0.0 / Supabase Edge Functions (Deno) / PostgreSQL 15 / Cloudflare R2 (S3-compat) / Firebase Cloud Messaging HTTP v1 / Next.js 16 / React 19 / Tailwind v4 / Pillow (Python) for image asset generation (one-shot, not a runtime dep).

**Resume protocol additions:** When resuming Plan 5, also read `~/.claude/projects/-Users-anthonygunawan-Sandbox-ai-projects-smart-tv-video-viewer/memory/MEMORY.md` and `CLAUDE.md` for current state. Plan 5 builds on Plans 1–4.1 (all done). Branch: `feature/plan-5-ota-polish` off main commit `bd02da4` (PR #6 merge of Plan 4.1).

---

## File Structure

### New files

**Database / Edge Functions:**
- `supabase/migrations/20260424001000_app_releases.sql` — adds 5 columns to `tenants` for OTA pointer
- `supabase/migrations/20260424001100_devices_fcm_dispatch.sql` — adds 3 columns to `devices` for dispatch outcome
- `supabase/functions/apk-upload-url/index.ts` — issues presigned R2 PUT URL for APK
- `supabase/functions/apk-publish/index.ts` — finalizes APK pointer with monotonic version_code guard
- `supabase/functions/_tests/apk_publish.test.ts` — Deno integration test for monotonic enforcement + happy path

**Dashboard:**
- `dashboard/app/(authed)/app-releases/page.tsx` — list current release + upload form
- `dashboard/app/(authed)/app-releases/upload-form.tsx` — client component, file picker + version inputs
- `dashboard/lib/actions/app-releases.ts` — server actions: `requestUploadUrl`, `publishRelease`

**Android — OTA:**
- `android-tv/app/src/main/java/com/ouie/signage/update/UpdateChecker.kt` — Koin single, polls config, downloads + verifies + installs
- `android-tv/app/src/main/java/com/ouie/signage/update/PackageInstallerHelper.kt` — wraps `PackageInstaller.Session` API
- `android-tv/app/src/test/java/com/ouie/signage/update/UpdateCheckerTest.kt` — unit test for version compare + sha256 verify

**Android — Cosmetic:**
- `android-tv/app/src/main/res/drawable-xhdpi/banner.png` — generated from `ouie logo.png` at 640×360
- `android-tv/app/src/main/res/drawable-xxhdpi/banner.png` — 960×540
- `android-tv/app/src/main/res/drawable-xxxhdpi/banner.png` — 1280×720
- `android-tv/app/src/main/res/drawable/ic_launcher_background.xml` — solid `#008058` color drawable
- `android-tv/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` — adaptive icon descriptor
- `android-tv/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml` — round-mask variant (same drawables)
- `android-tv/app/src/main/res/mipmap-mdpi/ic_launcher.png` — 48×48 legacy icon
- `android-tv/app/src/main/res/mipmap-hdpi/ic_launcher.png` — 72×72
- `android-tv/app/src/main/res/mipmap-xhdpi/ic_launcher.png` — 96×96
- `android-tv/app/src/main/res/mipmap-xxhdpi/ic_launcher.png` — 144×144
- `android-tv/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` — 192×192
- `android-tv/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png` — 108×108 with safe zone
- `android-tv/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png` — 162×162
- `android-tv/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png` — 216×216
- `android-tv/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png` — 324×324
- `android-tv/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png` — 432×432
- `android-tv/app/src/main/res/values/colors.xml` — brand color tokens
- `android-tv/app/src/main/java/com/ouie/signage/running/InitialSyncOverlay.kt` — branded loading composable
- `android-tv/app/build-tools/generate-assets.py` — one-shot Python script that regenerates the icon + banner from source logos (committed for reproducibility)

### Modified files

- `android-tv/app/src/main/AndroidManifest.xml` — add `REQUEST_INSTALL_PACKAGES` permission + `<queries>` for package installer + switch icon/banner refs to mipmap + apply Splash theme
- `android-tv/app/src/main/res/values/themes.xml` — add `Theme.SignageTv.Splash` parented on `Theme.SplashScreen`
- `android-tv/app/build.gradle.kts` — add `androidx.core:core-splashscreen` dependency, bump versionCode/versionName
- `android-tv/gradle/libs.versions.toml` — add splashscreen + version-catalog entry
- `android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt` — install splash screen via `installSplashScreen()` before super.onCreate
- `android-tv/app/src/main/java/com/ouie/signage/coordinator/RunningCoordinator.kt` — instantiate + start `UpdateChecker` (mirrors how `MediaSyncWorker` is wired)
- `android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt` — register `UpdateChecker` + `PackageInstallerHelper` Koin singles + new `OkHttpClient` for OTA downloads (or reuse `downloader` client)
- `android-tv/app/src/main/java/com/ouie/signage/config/ConfigResponse.kt` — add `app_release: AppReleaseDto?` field (and the dto)
- `android-tv/app/src/main/java/com/ouie/signage/fcm/FcmTokenSource.kt` — add suspending `forceRefresh()`
- `android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt` — track `firstAfterBoot`, call `fcmTokenSource.forceRefresh()` before first send
- `android-tv/app/src/main/java/com/ouie/signage/running/RunningScreen.kt` — show `InitialSyncOverlay` when initial sync incomplete
- `supabase/functions/devices-config/index.ts` — append `app_release` to response, presign 24h GET URL for APK
- `supabase/functions/devices-sync-now/index.ts` — capture sendFcmSync result, stamp dispatch columns
- `supabase/functions/_shared/fcm.ts` — change `sendFcmSync` return type from `Promise<void>` to `Promise<FcmDispatchResult>` exposing messageId/error
- `dashboard/app/(authed)/devices/[deviceId]/page.tsx` — extend FCM card with dispatch-outcome line
- `dashboard/components/sidebar.tsx` (or current nav location) — add "App Releases" link
- `CLAUDE.md` — update status block to reflect Plan 5 shipped
- `~/.claude/projects/.../memory/MEMORY.md` — add Plan 5 notes pointer

### One-shot asset generation pre-step

Before Task 11 (banner) or Task 12 (icon), the engineer runs `android-tv/app/build-tools/generate-assets.py` once, which reads source logos from `~/Downloads/ouie logo.png` and `~/Downloads/ouie circle logo.png` and writes all 18 PNG files. The script is committed so it can be re-run if the brand changes. Python 3 + Pillow required (`pip install pillow`).

---

# PHASE 1 — OTA Updates

## Task 1: Migration — `tenants.latest_apk_*` columns

**Files:**
- Create: `supabase/migrations/20260424001000_app_releases.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260424001000_app_releases.sql
-- Plan 5 Phase 1 Task 1.
-- OTA APK pointer per tenant. Single-row-per-tenant model: latest published
-- APK overwrites the previous one. We do not keep release history in v1 — the
-- monotonic version_code guard in apk-publish prevents accidental downgrades,
-- and rolling back is "publish an older artifact under a higher version_code"
-- (acceptable for a single-tenant self-use deployment).
ALTER TABLE tenants
    ADD COLUMN latest_apk_version_code int,
    ADD COLUMN latest_apk_version_name text,
    ADD COLUMN latest_apk_r2_path text,
    ADD COLUMN latest_apk_sha256 text,
    ADD COLUMN latest_apk_released_at timestamptz;

COMMENT ON COLUMN tenants.latest_apk_version_code IS
    'Android versionCode of the most-recently-published APK. Devices install when this exceeds BuildConfig.VERSION_CODE. NULL = no APK published yet.';
COMMENT ON COLUMN tenants.latest_apk_r2_path IS
    'R2 object key (e.g. tenants/<uuid>/apks/7.apk). devices-config presigns a 24h GET URL on each call.';
COMMENT ON COLUMN tenants.latest_apk_sha256 IS
    'Hex SHA-256 of the APK bytes. Device verifies after download and refuses install on mismatch.';
```

- [ ] **Step 2: Apply locally**

Run: `supabase db reset` (NOT push — reset rebuilds from migration history; safe pre-acceptance).
Expected: all 26 migrations apply, no errors.

- [ ] **Step 3: Restart PostgREST so schema cache picks up new columns**

Run: `docker restart supabase_rest_smart-tv-video-viewer`
Expected: container restarts, PostgREST exposes new columns (`NOTIFY pgrst, 'reload schema'` alone is insufficient per project conventions).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260424001000_app_releases.sql
git commit -m "feat(db): tenants OTA APK pointer columns (Plan 5 Task 1)"
```

---

## Task 2: Edge Function — `apk-upload-url`

**Files:**
- Create: `supabase/functions/apk-upload-url/index.ts`

This mirrors `media-upload-url` but writes to a different R2 path namespace and does NOT pre-insert a row (apk-publish creates the pointer atomically). No Deno test for this one — the test is on apk-publish, where the validation logic lives.

- [ ] **Step 1: Write the function**

```typescript
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
```

- [ ] **Step 2: Restart edge runtime so the new function is mounted**

Run: `docker restart supabase_edge_runtime_smart-tv-video-viewer`
Expected: container restarts, function appears in `supabase functions serve` discovery.

- [ ] **Step 3: Manual smoke**

Run:
```bash
curl -i -X POST http://127.0.0.1:54321/functions/v1/apk-upload-url \
  -H "Authorization: Bearer $(supabase status -o json | jq -r '.ANON_KEY')" \
  -H "content-type: application/json" \
  -d '{"version_code":99,"size_bytes":50000000}'
```
Expected: 401 unauthenticated (anon-key auth fails the user-scope check at tenant_members lookup) — confirms the auth gate trips before R2 work runs.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/apk-upload-url/index.ts
git commit -m "feat(fn): apk-upload-url edge function (Plan 5 Task 2)"
```

---

## Task 3: Edge Function — `apk-publish` with Deno test

**Files:**
- Create: `supabase/functions/apk-publish/index.ts`
- Create: `supabase/functions/_tests/apk_publish.test.ts`

- [ ] **Step 1: Write the failing Deno test**

```typescript
// supabase/functions/_tests/apk_publish.test.ts
// Plan 5 Phase 1 Task 3 — TDD.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function signInTestUser(email: string): Promise<string> {
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  // Use Supabase Admin API to provision + sign in a test user with a fresh tenant.
  await svc.auth.admin.createUser({ email, email_confirm: true, password: "test-password-1234" });
  const userClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await userClient.auth.signInWithPassword({
    email,
    password: "test-password-1234",
  });
  if (error) throw error;
  return data.session!.access_token;
}

async function tenantIdFor(jwt: string): Promise<string> {
  const u = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data } = await u.from("tenant_members").select("tenant_id").single();
  return data!.tenant_id;
}

Deno.test("apk-publish: happy path inserts pointer", async () => {
  const jwt = await signInTestUser(`apk-publish-happy-${crypto.randomUUID()}@test.local`);
  const tenantId = await tenantIdFor(jwt);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/apk-publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({
      version_code: 8,
      version_name: "0.5.0-p5",
      r2_path: `tenants/${tenantId}/apks/8.apk`,
      sha256: "a".repeat(64),
    }),
  });
  assertEquals(res.status, 200);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data } = await svc.from("tenants").select(
    "latest_apk_version_code,latest_apk_version_name,latest_apk_r2_path,latest_apk_sha256",
  ).eq("id", tenantId).single();
  assertEquals(data?.latest_apk_version_code, 8);
  assertEquals(data?.latest_apk_version_name, "0.5.0-p5");
  assertEquals(data?.latest_apk_r2_path, `tenants/${tenantId}/apks/8.apk`);
  assertEquals(data?.latest_apk_sha256, "a".repeat(64));
});

Deno.test("apk-publish: rejects non-monotonic version_code", async () => {
  const jwt = await signInTestUser(`apk-publish-mono-${crypto.randomUUID()}@test.local`);
  const tenantId = await tenantIdFor(jwt);
  // First publish: succeeds.
  const r1 = await fetch(`${SUPABASE_URL}/functions/v1/apk-publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({
      version_code: 10,
      version_name: "0.5.0",
      r2_path: `tenants/${tenantId}/apks/10.apk`,
      sha256: "b".repeat(64),
    }),
  });
  assertEquals(r1.status, 200);

  // Second publish with same version_code: rejected with 409.
  const r2 = await fetch(`${SUPABASE_URL}/functions/v1/apk-publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({
      version_code: 10,
      version_name: "0.5.1",
      r2_path: `tenants/${tenantId}/apks/10.apk`,
      sha256: "c".repeat(64),
    }),
  });
  assertEquals(r2.status, 409);

  // Third publish with lower version_code: also rejected.
  const r3 = await fetch(`${SUPABASE_URL}/functions/v1/apk-publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({
      version_code: 9,
      version_name: "0.4.9",
      r2_path: `tenants/${tenantId}/apks/9.apk`,
      sha256: "d".repeat(64),
    }),
  });
  assertEquals(r3.status, 409);

  // Confirm pointer still reflects the first successful publish.
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data } = await svc.from("tenants").select("latest_apk_version_code").eq(
    "id",
    tenantId,
  ).single();
  assertEquals(data?.latest_apk_version_code, 10);
});

Deno.test("apk-publish: rejects malformed sha256", async () => {
  const jwt = await signInTestUser(`apk-publish-sha-${crypto.randomUUID()}@test.local`);
  const tenantId = await tenantIdFor(jwt);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/apk-publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({
      version_code: 1,
      version_name: "0.0.1",
      r2_path: `tenants/${tenantId}/apks/1.apk`,
      sha256: "not-hex",
    }),
  });
  assertEquals(res.status, 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno task test -- supabase/functions/_tests/apk_publish.test.ts`
Expected: 3 tests fail with "Not Found" or 404 — function doesn't exist yet.

- [ ] **Step 3: Write the function**

```typescript
// supabase/functions/apk-publish/index.ts
// Plan 5 Phase 1 Task 3.
// Dashboard-facing: authenticated tenant user finalizes an APK release after
// the bytes have been PUT to R2 via apk-upload-url. We update the tenants
// pointer atomically with a monotonic version_code guard — refusing publishes
// where new version_code <= current. Sha256 is required and must be 64 hex
// chars (we don't re-hash the R2 object — the device verifies post-download).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

  // Conditional UPDATE: only succeeds when (current is NULL) OR (new > current).
  // Returns the row on success, empty on conflict — distinguish via row count.
  const { data: updated, error: updErr } = await userClient
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
```

- [ ] **Step 4: Restart edge runtime + run tests**

Run: `docker restart supabase_edge_runtime_smart-tv-video-viewer && deno task test -- supabase/functions/_tests/apk_publish.test.ts`
Expected: 3 tests pass (happy path, monotonic rejection, malformed sha256).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/apk-publish/index.ts supabase/functions/_tests/apk_publish.test.ts
git commit -m "feat(fn): apk-publish edge function with monotonic guard (Plan 5 Task 3)"
```

---

## Task 4: Extend `devices-config` to include `app_release`

**Files:**
- Modify: `supabase/functions/devices-config/index.ts`

- [ ] **Step 1: Add the app_release block to the response**

Read the current file. Below the existing tenant lookup, add a fetch of the tenant's APK pointer columns. Below the existing `media: mediaWithUrls` line in the payload, add an `app_release` field. The presigned URL is generated using the same `presignR2GetUrl` helper as media (24h TTL).

Edit `supabase/functions/devices-config/index.ts`:

Find this block:
```typescript
  // Revocation check
  const { data: dev, error: devErr } = await svc.from("devices")
    .select("id, tenant_id, store_id, fallback_playlist_id, revoked_at, stores(timezone)")
    .eq("id", claims.sub).single();
  if (devErr || !dev) return new Response("device gone", { status: 401 });
  if (dev.revoked_at) return new Response("revoked", { status: 401 });
```

Below it, add:
```typescript
  // Plan 5 Task 4: fetch APK pointer for this device's tenant. Null when no
  // APK has been published — device-side UpdateChecker no-ops on missing block.
  const { data: tenantRow } = await svc.from("tenants").select(
    "latest_apk_version_code, latest_apk_version_name, latest_apk_r2_path, latest_apk_sha256, latest_apk_released_at",
  ).eq("id", dev.tenant_id).maybeSingle();
```

Find this block:
```typescript
  const payload = {
    device: {
      id: dev.id,
      store_id: dev.store_id,
      fallback_playlist_id: dev.fallback_playlist_id,
      timezone: (dev as unknown as { stores: { timezone: string } }).stores.timezone,
    },
    rules: rules ?? [],
    playlists: ...
    media: mediaWithUrls,
  };
```

Add a new field after `media: mediaWithUrls,`:
```typescript
    app_release: tenantRow?.latest_apk_version_code != null && tenantRow.latest_apk_r2_path
      ? {
        version_code: tenantRow.latest_apk_version_code,
        version_name: tenantRow.latest_apk_version_name,
        sha256: tenantRow.latest_apk_sha256,
        released_at: tenantRow.latest_apk_released_at,
        url: await presignR2GetUrl({
          ...r2cfg,
          key: tenantRow.latest_apk_r2_path,
          ttlSeconds: 86400,
        }),
      }
      : null,
```

Add `app_release` to the version-hash stable string so changes invalidate the ETag (devices currently in 304-cached state will pick up new APKs on next poll). Find the `const stable = JSON.stringify({` block and add `app_release: ...` next to media:
```typescript
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
    // Plan 5 Task 4: include app_release in the version hash (excluding `url`
    // since presigned URLs rotate). version_code + sha256 capture the identity.
    app_release: tenantRow?.latest_apk_version_code != null
      ? {
        version_code: tenantRow.latest_apk_version_code,
        sha256: tenantRow.latest_apk_sha256,
      }
      : null,
  });
```

- [ ] **Step 2: Restart edge runtime + manual smoke**

Run: `docker restart supabase_edge_runtime_smart-tv-video-viewer`

Then make a config GET against the local stack with a real device JWT (look one up via `supabase db query "select id from devices limit 1"` then mint a JWT — the project already has a script for this in plan 3a).

Expected: response contains `"app_release": null` (no APK published in test data) OR a populated block if one exists. New ETag differs from any cached pre-Task-4 value.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/devices-config/index.ts
git commit -m "feat(fn): devices-config returns app_release pointer (Plan 5 Task 4)"
```

---

## Task 5: Dashboard — App Releases page

**Files:**
- Create: `dashboard/lib/actions/app-releases.ts`
- Create: `dashboard/app/(authed)/app-releases/page.tsx`
- Create: `dashboard/app/(authed)/app-releases/upload-form.tsx`
- Modify: `dashboard/components/sidebar.tsx` (or wherever the nav lives — engineer locates)

- [ ] **Step 1: Server actions**

```typescript
// dashboard/lib/actions/app-releases.ts
// Plan 5 Phase 1 Task 5.
"use server";

import { createServerSupabase } from "@/lib/supabase-server";

export type ReleaseRow = {
  version_code: number | null;
  version_name: string | null;
  released_at: string | null;
  sha256: string | null;
};

export async function getCurrentRelease(): Promise<ReleaseRow | null> {
  const supabase = await createServerSupabase();
  const { data: tm } = await supabase.from("tenant_members").select("tenant_id").maybeSingle();
  if (!tm) return null;
  const { data } = await supabase.from("tenants").select(
    "latest_apk_version_code, latest_apk_version_name, latest_apk_released_at, latest_apk_sha256",
  ).eq("id", tm.tenant_id).maybeSingle();
  if (!data) return null;
  return {
    version_code: data.latest_apk_version_code,
    version_name: data.latest_apk_version_name,
    released_at: data.latest_apk_released_at,
    sha256: data.latest_apk_sha256,
  };
}

export async function requestUploadUrl(input: {
  versionCode: number;
  sizeBytes: number;
}): Promise<{ r2_path: string; upload_url: string; expires_at: string }> {
  const supabase = await createServerSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("not authenticated");
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/apk-upload-url`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      version_code: input.versionCode,
      size_bytes: input.sizeBytes,
    }),
  });
  if (!res.ok) throw new Error(`apk-upload-url ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function publishRelease(input: {
  versionCode: number;
  versionName: string;
  r2Path: string;
  sha256: string;
}): Promise<void> {
  const supabase = await createServerSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("not authenticated");
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/apk-publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      version_code: input.versionCode,
      version_name: input.versionName,
      r2_path: input.r2Path,
      sha256: input.sha256,
    }),
  });
  if (!res.ok) throw new Error(`apk-publish ${res.status}: ${await res.text()}`);
}
```

- [ ] **Step 2: Page (server component)**

```typescript
// dashboard/app/(authed)/app-releases/page.tsx
// Plan 5 Phase 1 Task 5.
import { getCurrentRelease } from "@/lib/actions/app-releases";
import { UploadForm } from "./upload-form";

export default async function AppReleasesPage() {
  const release = await getCurrentRelease();
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">App Releases</h1>
      <section className="rounded border border-slate-700 p-4">
        <h2 className="mb-2 text-lg font-medium">Current release</h2>
        {release && release.version_code != null
          ? (
            <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-sm">
              <dt className="text-slate-400">Version</dt>
              <dd>{release.version_name} (versionCode {release.version_code})</dd>
              <dt className="text-slate-400">Published</dt>
              <dd>{release.released_at}</dd>
              <dt className="text-slate-400">SHA-256</dt>
              <dd className="font-mono text-xs break-all">{release.sha256}</dd>
            </dl>
          )
          : <p className="text-sm text-slate-400">No APK published yet.</p>}
      </section>
      <section className="rounded border border-slate-700 p-4">
        <h2 className="mb-2 text-lg font-medium">Publish new release</h2>
        <UploadForm currentVersionCode={release?.version_code ?? null} />
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Upload form (client component, computes sha256 in browser)**

```typescript
// dashboard/app/(authed)/app-releases/upload-form.tsx
// Plan 5 Phase 1 Task 5.
"use client";

import { useState, type FormEvent } from "react";
import { publishRelease, requestUploadUrl } from "@/lib/actions/app-releases";

async function computeSha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function UploadForm({ currentVersionCode }: { currentVersionCode: number | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [versionCode, setVersionCode] = useState<string>("");
  const [versionName, setVersionName] = useState<string>("");
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Choose an APK file");
    const vc = Number(versionCode);
    if (!Number.isInteger(vc) || vc <= 0) return setError("versionCode must be a positive integer");
    if (currentVersionCode != null && vc <= currentVersionCode) {
      return setError(`versionCode must exceed current (${currentVersionCode})`);
    }
    if (!versionName) return setError("versionName required");

    try {
      setProgress("Computing checksum…");
      const sha256 = await computeSha256Hex(file);

      setProgress("Requesting upload URL…");
      const { upload_url, r2_path } = await requestUploadUrl({
        versionCode: vc,
        sizeBytes: file.size,
      });

      setProgress(`Uploading ${(file.size / 1024 / 1024).toFixed(1)} MB to R2…`);
      const putRes = await fetch(upload_url, {
        method: "PUT",
        headers: { "content-type": "application/vnd.android.package-archive" },
        body: file,
      });
      if (!putRes.ok) throw new Error(`R2 PUT failed: ${putRes.status}`);

      setProgress("Publishing pointer…");
      await publishRelease({
        versionCode: vc,
        versionName,
        r2Path: r2_path,
        sha256,
      });

      setProgress("Done. Devices will install on next config poll (≤60s).");
      setFile(null);
      setVersionCode("");
      setVersionName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress("");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 text-sm">
      <div>
        <label className="block text-slate-400">APK file</label>
        <input
          type="file"
          accept=".apk,application/vnd.android.package-archive"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1"
        />
      </div>
      <div>
        <label className="block text-slate-400">versionCode (integer)</label>
        <input
          type="number"
          value={versionCode}
          onChange={(e) => setVersionCode(e.target.value)}
          className="mt-1 w-32 rounded border border-slate-700 bg-slate-900 px-2 py-1"
        />
      </div>
      <div>
        <label className="block text-slate-400">versionName (e.g. 0.5.0)</label>
        <input
          type="text"
          value={versionName}
          onChange={(e) => setVersionName(e.target.value)}
          className="mt-1 w-48 rounded border border-slate-700 bg-slate-900 px-2 py-1"
        />
      </div>
      <button
        type="submit"
        className="rounded bg-emerald-600 px-3 py-1 text-white hover:bg-emerald-500"
      >
        Upload + Publish
      </button>
      {progress && <p className="text-slate-300">{progress}</p>}
      {error && <p className="text-red-400">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 4: Add nav link**

Locate the dashboard's nav component (likely `dashboard/components/sidebar.tsx` or similar — engineer greps for existing nav links like "Devices" or "Stores" to find the pattern). Add an entry:

```tsx
<NavLink href="/app-releases">App Releases</NavLink>
```

(Match the surrounding NavLink/Link component style — don't invent a new pattern.)

- [ ] **Step 5: Manual smoke locally**

Build a debug APK first: `cd android-tv && ./gradlew :app:assembleDebug`. The output is at `android-tv/app/build/outputs/apk/debug/app-debug.apk`.

Visit `http://localhost:3000/app-releases`, log in, upload the APK with versionCode=99 (anything > current 7) and versionName="0.5.0-test". Expected: progress text walks through "Computing checksum → Requesting upload URL → Uploading X MB → Publishing pointer → Done." After refresh, the page shows the new release in the "Current release" section.

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/\(authed\)/app-releases dashboard/lib/actions/app-releases.ts dashboard/components/
git commit -m "feat(dash): App Releases page with two-phase APK upload (Plan 5 Task 5)"
```

---

## Task 6: Android — manifest permissions + queries

**Files:**
- Modify: `android-tv/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Add permissions and queries**

Edit `android-tv/app/src/main/AndroidManifest.xml`. Below the existing `<uses-permission>` block, add:

```xml
    <!-- Plan 5 Phase 1 Task 6 — OTA install path. -->
    <!-- REQUEST_INSTALL_PACKAGES is a normal permission since API 26 but the
         user must additionally grant "Install unknown apps" for our package
         via Settings → Apps → Special access. UpdateChecker checks
         packageManager.canRequestPackageInstalls() and surfaces an ErrorBus
         event if denied. -->
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
```

Inside `<application>` but as a sibling of `<application>` (top-level under `<manifest>`), add the queries element so PackageInstaller intent resolution works on Android 11+:

```xml
    <!-- Plan 5 Task 6: Android 11+ package visibility — let our package see
         the system PackageInstaller so PackageInstaller.Session can fire its
         status PendingIntent without being silently filtered. -->
    <queries>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:mimeType="application/vnd.android.package-archive" />
        </intent>
    </queries>
```

(The `<queries>` element goes at the top level of `<manifest>`, NOT inside `<application>`.)

- [ ] **Step 2: Build to verify manifest validity**

Run: `cd android-tv && ./gradlew :app:processDebugManifest`
Expected: BUILD SUCCESSFUL, no manifest merger errors.

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/AndroidManifest.xml
git commit -m "feat(android): REQUEST_INSTALL_PACKAGES + package-installer queries (Plan 5 Task 6)"
```

---

## Task 7: Android — `ConfigResponse.app_release` (TDD)

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/config/ConfigResponse.kt`
- Modify: `android-tv/app/src/test/java/com/ouie/signage/config/ConfigResponseTest.kt` (or create if absent)

- [ ] **Step 1: Read the existing ConfigResponse to see naming conventions**

Read `android-tv/app/src/main/java/com/ouie/signage/config/ConfigResponse.kt`.

- [ ] **Step 2: Write the failing test**

If `ConfigResponseTest.kt` does not exist, create it. Otherwise add a new test method. The test asserts that the JSON shape returned by `devices-config` (with the Task 4 additions) deserializes into the expected Kotlin structure.

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/config/ConfigResponseTest.kt
// Plan 5 Phase 1 Task 7 — TDD.
package com.ouie.signage.config

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class ConfigResponseTest {

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    @Test
    fun `decodes app_release block when present`() {
        val raw = """
        {
          "version": "sha256:abc",
          "device": {"id":"d1","store_id":"s1","fallback_playlist_id":null,"timezone":"Asia/Jakarta"},
          "rules": [],
          "playlists": [],
          "media": [],
          "app_release": {
            "version_code": 8,
            "version_name": "0.5.0-p5",
            "sha256": "${"a".repeat(64)}",
            "released_at": "2026-04-24T10:00:00Z",
            "url": "https://r2.example/apks/8.apk?sig=xyz"
          }
        }
        """.trimIndent()
        val cfg = json.decodeFromString<ConfigResponse>(raw)
        assertNotNull(cfg.app_release)
        assertEquals(8, cfg.app_release?.version_code)
        assertEquals("0.5.0-p5", cfg.app_release?.version_name)
        assertEquals("a".repeat(64), cfg.app_release?.sha256)
        assertEquals("https://r2.example/apks/8.apk?sig=xyz", cfg.app_release?.url)
    }

    @Test
    fun `decodes null app_release as null`() {
        val raw = """
        {
          "version": "sha256:abc",
          "device": {"id":"d1","store_id":"s1","fallback_playlist_id":null,"timezone":"Asia/Jakarta"},
          "rules": [],
          "playlists": [],
          "media": [],
          "app_release": null
        }
        """.trimIndent()
        val cfg = json.decodeFromString<ConfigResponse>(raw)
        assertNull(cfg.app_release)
    }

    @Test
    fun `tolerates omitted app_release field`() {
        val raw = """
        {
          "version": "sha256:abc",
          "device": {"id":"d1","store_id":"s1","fallback_playlist_id":null,"timezone":"Asia/Jakarta"},
          "rules": [],
          "playlists": [],
          "media": []
        }
        """.trimIndent()
        val cfg = json.decodeFromString<ConfigResponse>(raw)
        assertNull(cfg.app_release)
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.config.ConfigResponseTest"`
Expected: 3 failures referencing missing `app_release` property on `ConfigResponse`.

- [ ] **Step 4: Add the dto and field**

In `ConfigResponse.kt`, add a new `@Serializable` data class and a nullable field on `ConfigResponse`:

```kotlin
@Serializable
data class AppReleaseDto(
    val version_code: Int,
    val version_name: String,
    val sha256: String,
    val released_at: String? = null,
    val url: String,
)
```

And in the existing `ConfigResponse` class, add as the last field (defaulting to null so old cached responses continue to deserialize):

```kotlin
    val app_release: AppReleaseDto? = null,
```

- [ ] **Step 5: Run tests — pass**

Run: `cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.config.ConfigResponseTest"`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/config/ConfigResponse.kt android-tv/app/src/test/java/com/ouie/signage/config/ConfigResponseTest.kt
git commit -m "feat(android): ConfigResponse.app_release dto (Plan 5 Task 7)"
```

---

## Task 8: Android — `UpdateChecker` (TDD)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/update/UpdateChecker.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/update/UpdateCheckerTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/update/UpdateCheckerTest.kt
// Plan 5 Phase 1 Task 8 — TDD.
package com.ouie.signage.update

import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class UpdateCheckerTest {

    private lateinit var server: MockWebServer
    private lateinit var workDir: File

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        workDir = createTempDir(prefix = "ota-test")
    }

    @After fun tearDown() {
        server.shutdown()
        workDir.deleteRecursively()
    }

    private fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it) }

    @Test fun `noop when current version is already at or above release`() = runTest {
        val checker = UpdateChecker(
            httpClient = OkHttpClient(),
            updatesDir = workDir,
            currentVersionCode = 10,
            installer = RecordingInstaller(),
        )
        val outcome = checker.checkAndDownload(
            UpdateChecker.Release(
                version_code = 10, version_name = "0.5.0",
                sha256 = "deadbeef".repeat(8), url = "http://unused/",
            ),
        )
        assertEquals(UpdateChecker.Outcome.AlreadyCurrent, outcome)
    }

    @Test fun `downloads, verifies sha256, hands to installer`() = runTest {
        val apkBytes = ByteArray(1024) { (it % 256).toByte() }
        val sha = sha256Hex(apkBytes)
        server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(apkBytes)))
        val installer = RecordingInstaller()
        val checker = UpdateChecker(
            httpClient = OkHttpClient(),
            updatesDir = workDir,
            currentVersionCode = 7,
            installer = installer,
        )
        val outcome = checker.checkAndDownload(
            UpdateChecker.Release(
                version_code = 8, version_name = "0.5.0-p5",
                sha256 = sha, url = server.url("/apk").toString(),
            ),
        )
        assertEquals(UpdateChecker.Outcome.Installing, outcome)
        assertTrue(installer.invocations.size == 1)
        assertEquals(8, installer.invocations[0].versionCode)
        assertTrue(installer.invocations[0].apk.exists())
        assertEquals(apkBytes.size.toLong(), installer.invocations[0].apk.length())
    }

    @Test fun `rejects sha256 mismatch and deletes partial file`() = runTest {
        val apkBytes = ByteArray(1024) { (it % 256).toByte() }
        val wrongSha = "0".repeat(64)
        server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(apkBytes)))
        val installer = RecordingInstaller()
        val checker = UpdateChecker(
            httpClient = OkHttpClient(),
            updatesDir = workDir,
            currentVersionCode = 7,
            installer = installer,
        )
        val outcome = checker.checkAndDownload(
            UpdateChecker.Release(
                version_code = 8, version_name = "0.5.0-p5",
                sha256 = wrongSha, url = server.url("/apk").toString(),
            ),
        )
        assertEquals(UpdateChecker.Outcome.ChecksumMismatch, outcome)
        assertFalse(installer.invocations.any { it.versionCode == 8 })
        // Partial download is removed so next attempt has no stale bytes.
        assertEquals(0, workDir.listFiles()?.size ?: 0)
    }

    @Test fun `skips redownload when local file already matches sha256`() = runTest {
        val apkBytes = ByteArray(1024) { (it % 256).toByte() }
        val sha = sha256Hex(apkBytes)
        // Pre-place a file at the expected path.
        File(workDir, "8.apk").writeBytes(apkBytes)
        val installer = RecordingInstaller()
        val checker = UpdateChecker(
            httpClient = OkHttpClient(),
            updatesDir = workDir,
            currentVersionCode = 7,
            installer = installer,
        )
        val outcome = checker.checkAndDownload(
            UpdateChecker.Release(
                version_code = 8, version_name = "0.5.0-p5",
                sha256 = sha, url = server.url("/never-called").toString(),
            ),
        )
        assertEquals(UpdateChecker.Outcome.Installing, outcome)
        assertEquals(0, server.requestCount) // no HTTP call made
    }
}

private class RecordingInstaller : ApkInstaller {
    data class Invocation(val versionCode: Int, val apk: File)
    val invocations = mutableListOf<Invocation>()
    override suspend fun install(versionCode: Int, apk: File) {
        invocations += Invocation(versionCode, apk)
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.update.UpdateCheckerTest"`
Expected: compile errors — `UpdateChecker`, `ApkInstaller`, `Outcome`, `Release` not defined.

- [ ] **Step 3: Implement UpdateChecker**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/update/UpdateChecker.kt
// Plan 5 Phase 1 Task 8.
// Reads the app_release pointer from each config refresh, downloads the APK
// to <cache_root>/updates/<versionCode>.apk, verifies sha256, then hands to
// PackageInstaller. On sha256 mismatch the partial file is deleted so the
// next attempt re-downloads cleanly. On already-cached match, skips the HTTP
// fetch entirely.
package com.ouie.signage.update

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest

interface ApkInstaller {
    suspend fun install(versionCode: Int, apk: File)
}

class UpdateChecker(
    private val httpClient: OkHttpClient,
    private val updatesDir: File,
    private val currentVersionCode: Int,
    private val installer: ApkInstaller,
) {

    @Serializable
    data class Release(
        val version_code: Int,
        val version_name: String,
        val sha256: String,
        val url: String,
    )

    enum class Outcome {
        AlreadyCurrent,
        Installing,
        ChecksumMismatch,
        DownloadFailed,
    }

    suspend fun checkAndDownload(release: Release): Outcome = withContext(Dispatchers.IO) {
        if (release.version_code <= currentVersionCode) return@withContext Outcome.AlreadyCurrent

        updatesDir.mkdirs()
        val target = File(updatesDir, "${release.version_code}.apk")

        // Reuse a previously-completed download if its bytes match the expected
        // sha256. Speeds repeated install attempts (e.g. user dismissed the
        // system dialog and we retry on the next config poll).
        if (target.exists() && sha256Hex(target) == release.sha256) {
            installer.install(release.version_code, target)
            return@withContext Outcome.Installing
        }

        try {
            httpClient.newCall(Request.Builder().url(release.url).get().build()).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext Outcome.DownloadFailed
                val body = resp.body ?: return@withContext Outcome.DownloadFailed
                target.outputStream().use { out -> body.byteStream().copyTo(out) }
            }
        } catch (e: CancellationException) {
            target.delete()
            throw e
        } catch (_: Throwable) {
            target.delete()
            return@withContext Outcome.DownloadFailed
        }

        if (sha256Hex(target) != release.sha256) {
            target.delete()
            return@withContext Outcome.ChecksumMismatch
        }

        installer.install(release.version_code, target)
        Outcome.Installing
    }

    private fun sha256Hex(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
```

- [ ] **Step 4: Run tests — pass**

Run: `cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.update.UpdateCheckerTest"`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/update/UpdateChecker.kt android-tv/app/src/test/java/com/ouie/signage/update/UpdateCheckerTest.kt
git commit -m "feat(android): UpdateChecker downloads + verifies + delegates install (Plan 5 Task 8)"
```

---

## Task 9: Android — `PackageInstallerHelper`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/update/PackageInstallerHelper.kt`

This implementation is intentionally not unit-tested — it wraps Android framework APIs (`PackageInstaller.Session`) that don't mock cleanly. Behavior verification happens in real-hardware acceptance (Phase 4).

- [ ] **Step 1: Implement**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/update/PackageInstallerHelper.kt
// Plan 5 Phase 1 Task 9.
// Wraps PackageInstaller.Session for sideload-installs initiated by the app.
// The user must have granted "Install unknown apps" for our package via
// Settings — we surface a clear error via ErrorBus when canRequestPackageInstalls()
// returns false. Note: install REPLACES the running app — Android kills our
// process and restarts it after install completes. SignageService START_STICKY
// brings the headless service back; MainActivity reopens via launcher when the
// operator next interacts.
package com.ouie.signage.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import com.ouie.signage.errorbus.ErrorBus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

class PackageInstallerHelper(
    private val context: Context,
    private val errorBus: ErrorBus,
) : ApkInstaller {

    override suspend fun install(versionCode: Int, apk: File) = withContext(Dispatchers.IO) {
        val pm = context.packageManager
        if (!pm.canRequestPackageInstalls()) {
            errorBus.report(
                kind = "ota_install_blocked",
                mediaId = null,
                message = "Install unknown apps not granted — go to Settings → Apps → Special access → Install unknown apps and enable for Signage",
            )
            return@withContext
        }

        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            apk.inputStream().use { input ->
                session.openWrite("apk", 0, apk.length()).use { output ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        output.write(buf, 0, n)
                    }
                    session.fsync(output)
                }
            }

            // Status PendingIntent — required by PackageInstaller.commit().
            // We don't process the result (Android's system dialog handles UX);
            // the broadcast is fired only so commit() doesn't reject for a
            // missing receiver. Using FLAG_MUTABLE because the system fills in
            // status extras.
            val statusIntent = Intent("com.ouie.signage.OTA_INSTALL_STATUS")
                .setPackage(context.packageName)
            val statusPi = PendingIntent.getBroadcast(
                context,
                versionCode,
                statusIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            session.commit(statusPi.intentSender)
        }
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd android-tv && ./gradlew :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/update/PackageInstallerHelper.kt
git commit -m "feat(android): PackageInstallerHelper wraps install session (Plan 5 Task 9)"
```

---

## Task 10: Android — wire UpdateChecker into RunningCoordinator + Koin

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt`
- Modify: `android-tv/app/src/main/java/com/ouie/signage/coordinator/RunningCoordinator.kt`

- [ ] **Step 1: Read AppModule.kt to find the right insertion point**

Run: `grep -n "single\|factory" android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt | head -20`

Locate the existing Koin singles for `RunningCoordinator`, `ErrorBus`, `FcmTokenSource`. Insert the new singles in the same style (the engineer matches the existing pattern — typically `single { PackageInstallerHelper(androidContext(), get()) } bind ApkInstaller::class` and `single { UpdateChecker(... ) }`).

- [ ] **Step 2: Add Koin singles for PackageInstallerHelper and UpdateChecker**

Edit `android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt`. Find the section where `MediaDownloader` or `RunningCoordinator` is registered and add nearby:

```kotlin
    // Plan 5 Task 10 — OTA install path.
    single<ApkInstaller> { PackageInstallerHelper(androidContext(), get()) }
```

(Note: `UpdateChecker` is NOT registered as a Koin single because its constructor takes `currentVersionCode` and `updatesDir` which are determined inside `RunningCoordinator.start()` — same pattern as `MediaDownloader` already follows in `RunningCoordinator.kt`.)

Update the `RunningCoordinator` factory line in the module if needed to inject the `ApkInstaller`:

Find:
```kotlin
    single { RunningCoordinator(
        context = androidContext(),
        downloaderHttpClient = get(named("downloader")),
        configApi = get(),
        ...
    ) }
```

Add `apkInstaller = get(),` to the constructor call.

- [ ] **Step 3: Wire UpdateChecker inside RunningCoordinator.start()**

Edit `android-tv/app/src/main/java/com/ouie/signage/coordinator/RunningCoordinator.kt`.

Add a constructor parameter at the end of the parameter list:
```kotlin
    private val apkInstaller: ApkInstaller,
```

(import `com.ouie.signage.update.ApkInstaller`)

Inside `start()`, after the `MediaSyncWorker` block and before `ConfigPoller`, add:

```kotlin
        // Plan 5 Task 10: OTA — react to app_release on every config refresh.
        // updatesDir lives next to the media cache so OS-level "clear cache"
        // wipes both. UpdateChecker no-ops when version_code <= our own.
        val updatesDir = File(pick.root, "updates")
        val updater = UpdateChecker(
            httpClient = downloaderHttpClient,
            updatesDir = updatesDir,
            currentVersionCode = com.ouie.signage.BuildConfig.VERSION_CODE,
            installer = apkInstaller,
        )
        configRepo.current.onEach { cfg ->
            val release = cfg?.app_release ?: return@onEach
            try {
                updater.checkAndDownload(
                    UpdateChecker.Release(
                        version_code = release.version_code,
                        version_name = release.version_name,
                        sha256 = release.sha256,
                        url = release.url,
                    ),
                )
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (t: Throwable) {
                errorBus.report("ota_check_failed", null, t.message)
            }
        }.launchIn(newScope)
```

(import `com.ouie.signage.update.UpdateChecker`)

- [ ] **Step 4: Build the debug APK**

Run: `cd android-tv && ./gradlew :app:assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Run the full unit-test suite to make sure nothing broke**

Run: `cd android-tv && ./gradlew :app:testDebugUnitTest`
Expected: all tests pass (UpdateChecker plus pre-existing).

- [ ] **Step 6: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt android-tv/app/src/main/java/com/ouie/signage/coordinator/RunningCoordinator.kt
git commit -m "feat(android): wire UpdateChecker into RunningCoordinator (Plan 5 Task 10)"
```

---

# PHASE 2 — Cosmetic Polish

## Task 11: One-shot asset generation script

**Files:**
- Create: `android-tv/app/build-tools/generate-assets.py`

This script regenerates banner + adaptive icon foreground PNGs from the source logos. Committed for reproducibility — re-run if brand changes. Required Python deps: `pillow`.

- [ ] **Step 1: Verify Pillow is installed**

Run: `python3 -c "import PIL; print(PIL.__version__)"`
Expected: prints a version number. If not, run: `pip3 install pillow`.

- [ ] **Step 2: Write the script**

```python
#!/usr/bin/env python3
# android-tv/app/build-tools/generate-assets.py
# Plan 5 Phase 2 Task 11.
# One-shot — regenerates Leanback banner + adaptive icon foreground + legacy
# launcher PNGs from the source logos. Re-run if the brand assets change.
# Requires: pillow (pip3 install pillow).
#
# Source files:
#   ~/Downloads/ouie logo.png         — wide wordmark, 3668x1152, transparent
#   ~/Downloads/ouie circle logo.png  — circle disc + white wordmark, 2202x1952
#
# Output: writes into android-tv/app/src/main/res/{drawable-*,mipmap-*}.

from pathlib import Path
from PIL import Image, ImageOps

REPO = Path(__file__).resolve().parents[3]
RES = REPO / "android-tv" / "app" / "src" / "main" / "res"

WORDMARK_SRC = Path.home() / "Downloads" / "ouie logo.png"
CIRCLE_SRC = Path.home() / "Downloads" / "ouie circle logo.png"

BRAND_GREEN = (0, 128, 88, 255)  # #008058 — verified by pixel-cluster analysis

# Leanback banner sizes (16:9). Skipping mdpi/hdpi as F&B TVs are 1080p+.
BANNER_DENSITIES = {
    "drawable-xhdpi":   (640, 360),
    "drawable-xxhdpi":  (960, 540),
    "drawable-xxxhdpi": (1280, 720),
}

# Legacy ic_launcher (square). API 26+ uses adaptive but legacy launchers fall
# back to these PNGs.
LAUNCHER_DENSITIES = {
    "mipmap-mdpi":    48,
    "mipmap-hdpi":    72,
    "mipmap-xhdpi":   96,
    "mipmap-xxhdpi":  144,
    "mipmap-xxxhdpi": 192,
}

# Adaptive icon foreground — 108dp canvas. Safe zone for the visible content
# is the inner 66dp circle. Foreground PNGs are the full 108dp canvas; the
# foreground graphic must sit inside the inner 66dp diameter.
FOREGROUND_DENSITIES = {
    "mipmap-mdpi":    108,
    "mipmap-hdpi":    162,
    "mipmap-xhdpi":   216,
    "mipmap-xxhdpi":  324,
    "mipmap-xxxhdpi": 432,
}


def recolor_alpha_to_white(img: Image.Image) -> Image.Image:
    """Replace every visible (non-transparent) pixel with white, preserving alpha.
    Used to convert the green source wordmark into a white wordmark for placement
    on a brand-green banner background."""
    img = img.convert("RGBA")
    pixels = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = pixels[x, y]
            if a > 0:
                pixels[x, y] = (255, 255, 255, a)
    return img


def make_banner(out: Path, target_w: int, target_h: int) -> None:
    """Banner = brand-green canvas with white wordmark centered, ~80% width."""
    bg = Image.new("RGBA", (target_w, target_h), BRAND_GREEN)
    src = Image.open(WORDMARK_SRC).convert("RGBA")
    src = recolor_alpha_to_white(src)
    margin_w = int(target_w * 0.10)
    inner_w = target_w - 2 * margin_w
    aspect = src.width / src.height
    inner_h_max = int(target_h * 0.70)
    if inner_w / aspect <= inner_h_max:
        new_w, new_h = inner_w, int(inner_w / aspect)
    else:
        new_h, new_w = inner_h_max, int(inner_h_max * aspect)
    src = src.resize((new_w, new_h), Image.LANCZOS)
    pos = ((target_w - new_w) // 2, (target_h - new_h) // 2)
    bg.alpha_composite(src, pos)
    out.parent.mkdir(parents=True, exist_ok=True)
    bg.convert("RGB").save(out, "PNG", optimize=True)
    print(f"banner -> {out.relative_to(REPO)} ({target_w}x{target_h})")


def make_legacy_launcher(out: Path, size: int) -> None:
    """Legacy ic_launcher.png — circle logo scaled to size, transparent margin."""
    src = Image.open(CIRCLE_SRC).convert("RGBA")
    # Square-pad to source's max dim so resize doesn't distort.
    side = max(src.width, src.height)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(src, ((side - src.width) // 2, (side - src.height) // 2))
    icon = canvas.resize((size, size), Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    icon.save(out, "PNG", optimize=True)
    print(f"launcher -> {out.relative_to(REPO)} ({size}x{size})")


def make_adaptive_foreground(out: Path, size: int) -> None:
    """Adaptive icon foreground — 108dp canvas, content inside inner ~66dp circle.
    We use the circle logo as the foreground, scaled to fit the safe zone,
    centered on a transparent canvas."""
    src = Image.open(CIRCLE_SRC).convert("RGBA")
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # Safe zone: inner 66dp of 108dp = 61% diameter. Scale source to that.
    safe = int(size * 0.61)
    aspect = src.width / src.height
    if aspect > 1:
        new_w, new_h = safe, int(safe / aspect)
    else:
        new_h, new_w = safe, int(safe * aspect)
    src = src.resize((new_w, new_h), Image.LANCZOS)
    pos = ((size - new_w) // 2, (size - new_h) // 2)
    canvas.alpha_composite(src, pos)
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, "PNG", optimize=True)
    print(f"foreground -> {out.relative_to(REPO)} ({size}x{size})")


def main() -> None:
    if not WORDMARK_SRC.exists():
        raise SystemExit(f"missing source: {WORDMARK_SRC}")
    if not CIRCLE_SRC.exists():
        raise SystemExit(f"missing source: {CIRCLE_SRC}")

    for density, (w, h) in BANNER_DENSITIES.items():
        make_banner(RES / density / "banner.png", w, h)
    for density, size in LAUNCHER_DENSITIES.items():
        make_legacy_launcher(RES / density / "ic_launcher.png", size)
        make_legacy_launcher(RES / density / "ic_launcher_round.png", size)
    for density, size in FOREGROUND_DENSITIES.items():
        make_adaptive_foreground(RES / density / "ic_launcher_foreground.png", size)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run it**

Run: `python3 android-tv/app/build-tools/generate-assets.py`
Expected output: 18 lines like `banner -> .../banner.png (640x360)` etc., no errors.

- [ ] **Step 4: Verify generated files exist**

Run: `find android-tv/app/src/main/res -name "banner.png" -o -name "ic_launcher.png" -o -name "ic_launcher_foreground.png" | sort | wc -l`
Expected: `18` (3 banners + 5 ic_launcher + 5 ic_launcher_round + 5 foreground = 18).

- [ ] **Step 5: Sanity-check a few visually**

Open `android-tv/app/src/main/res/drawable-xxxhdpi/banner.png` in Preview — should show the white "ouie" wordmark on a brand-green background, centered, no blur. Open `mipmap-xxxhdpi/ic_launcher.png` — should show the green circle with the "Ouie!" white wordmark inside, no aliasing.

- [ ] **Step 6: Commit**

```bash
git add android-tv/app/build-tools/generate-assets.py \
        android-tv/app/src/main/res/drawable-xhdpi/banner.png \
        android-tv/app/src/main/res/drawable-xxhdpi/banner.png \
        android-tv/app/src/main/res/drawable-xxxhdpi/banner.png \
        android-tv/app/src/main/res/mipmap-mdpi/ic_launcher.png \
        android-tv/app/src/main/res/mipmap-hdpi/ic_launcher.png \
        android-tv/app/src/main/res/mipmap-xhdpi/ic_launcher.png \
        android-tv/app/src/main/res/mipmap-xxhdpi/ic_launcher.png \
        android-tv/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png \
        android-tv/app/src/main/res/mipmap-mdpi/ic_launcher_round.png \
        android-tv/app/src/main/res/mipmap-hdpi/ic_launcher_round.png \
        android-tv/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png \
        android-tv/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png \
        android-tv/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png \
        android-tv/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png \
        android-tv/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png \
        android-tv/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png \
        android-tv/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png \
        android-tv/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png
git commit -m "feat(android): branded banner + adaptive icon assets (Plan 5 Task 11)"
```

---

## Task 12: Adaptive icon descriptors + brand colors

**Files:**
- Create: `android-tv/app/src/main/res/values/colors.xml`
- Create: `android-tv/app/src/main/res/drawable/ic_launcher_background.xml`
- Create: `android-tv/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- Create: `android-tv/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`

- [ ] **Step 1: Define brand colors**

```xml
<!-- android-tv/app/src/main/res/values/colors.xml -->
<!-- Plan 5 Phase 2 Task 12. Brand color tokens. -->
<resources>
    <!-- Brand green — verified by pixel-cluster analysis of source logos. -->
    <color name="brand_green">#008058</color>
    <!-- Black background for video surfaces. -->
    <color name="background_black">#000000</color>
</resources>
```

- [ ] **Step 2: Adaptive icon background drawable**

```xml
<!-- android-tv/app/src/main/res/drawable/ic_launcher_background.xml -->
<!-- Plan 5 Task 12. Adaptive icon background layer. Solid brand-green —
     the foreground (white wordmark on transparent) sits on top. The launcher
     mask shapes both layers identically. -->
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/brand_green" />
</shape>
```

- [ ] **Step 3: Adaptive icon descriptor**

```xml
<!-- android-tv/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml -->
<!-- Plan 5 Task 12. Adaptive icon for Android 8+ launchers. -->
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
```

- [ ] **Step 4: Round-mask variant (same layers)**

```xml
<!-- android-tv/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml -->
<!-- Plan 5 Task 12. Identical layers; launcher applies round mask. -->
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
```

- [ ] **Step 5: Switch manifest icon + banner refs**

Edit `android-tv/app/src/main/AndroidManifest.xml`. Find:
```xml
        android:banner="@drawable/banner"
        android:icon="@drawable/banner"
```
Replace with:
```xml
        android:banner="@drawable/banner"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round"
```

(`@drawable/banner` continues to work because `drawable-xhdpi/banner.png` etc. resolve to `@drawable/banner` per Android resource conventions. The OLD `drawable/banner.xml` should be deleted to avoid ambiguity — the engineer runs the next step.)

- [ ] **Step 6: Delete the placeholder vector banner**

Run: `rm android-tv/app/src/main/res/drawable/banner.xml`

- [ ] **Step 7: Build to verify**

Run: `cd android-tv && ./gradlew :app:assembleDebug`
Expected: BUILD SUCCESSFUL. (If it complains about `@drawable/banner` ambiguity, ensure the .xml is gone and only the per-density PNGs remain.)

- [ ] **Step 8: Commit**

```bash
git add android-tv/app/src/main/res/values/colors.xml \
        android-tv/app/src/main/res/drawable/ic_launcher_background.xml \
        android-tv/app/src/main/res/mipmap-anydpi-v26/ \
        android-tv/app/src/main/AndroidManifest.xml
git rm android-tv/app/src/main/res/drawable/banner.xml
git commit -m "feat(android): adaptive icon + brand colors, drop placeholder banner (Plan 5 Task 12)"
```

---

## Task 13: Splash screen theme

**Files:**
- Modify: `android-tv/gradle/libs.versions.toml`
- Modify: `android-tv/app/build.gradle.kts`
- Modify: `android-tv/app/src/main/res/values/themes.xml`
- Modify: `android-tv/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Add splashscreen dependency to version catalog**

Edit `android-tv/gradle/libs.versions.toml`. In `[versions]`, add:
```toml
splashscreen = "1.0.1"
```

In `[libraries]`, add:
```toml
androidx-core-splashscreen = { module = "androidx.core:core-splashscreen", version.ref = "splashscreen" }
```

- [ ] **Step 2: Reference it in app/build.gradle.kts**

Edit `android-tv/app/build.gradle.kts`. In the `dependencies { ... }` block, add (alphabetically positioned with the existing `androidx.core.ktx` line):
```kotlin
    implementation(libs.androidx.core.splashscreen)
```

- [ ] **Step 3: Read existing themes.xml to preserve parent theme**

Run: `cat android-tv/app/src/main/res/values/themes.xml`

Expected: existing `Theme.SignageTv` style. The new splash theme must inherit the SplashScreen Material parent and forward to `Theme.SignageTv` as `postSplashScreenTheme`.

- [ ] **Step 4: Add the splash theme**

Edit `android-tv/app/src/main/res/values/themes.xml`. Add a new `<style>` block (placement: after the existing `Theme.SignageTv` block):

```xml
    <!-- Plan 5 Phase 2 Task 13. Splash theme — applied at app launch, hands
         off to Theme.SignageTv after MainActivity.onCreate runs. Brand-green
         window background + foreground icon centered (uses the same adaptive
         icon foreground as the app icon, so the splash visually anchors to
         the launcher icon). -->
    <style name="Theme.SignageTv.Splash" parent="Theme.SplashScreen">
        <item name="windowSplashScreenBackground">@color/brand_green</item>
        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
        <item name="postSplashScreenTheme">@style/Theme.SignageTv</item>
    </style>
```

- [ ] **Step 5: Apply splash theme to MainActivity in manifest**

Edit `android-tv/app/src/main/AndroidManifest.xml`. Find the MainActivity block:
```xml
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTask"
            android:screenOrientation="landscape"
            android:theme="@style/Theme.SignageTv">
```
Change `android:theme` to:
```xml
            android:theme="@style/Theme.SignageTv.Splash">
```

- [ ] **Step 6: Build to confirm theme resolves**

Run: `cd android-tv && ./gradlew :app:assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 7: Commit**

```bash
git add android-tv/gradle/libs.versions.toml android-tv/app/build.gradle.kts \
        android-tv/app/src/main/res/values/themes.xml android-tv/app/src/main/AndroidManifest.xml
git commit -m "feat(android): SplashScreen API theme with brand-green + foreground icon (Plan 5 Task 13)"
```

---

## Task 14: Install SplashScreen handoff in MainActivity

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt`

- [ ] **Step 1: Wire installSplashScreen()**

Edit `android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt`. Add import:
```kotlin
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
```

Modify `onCreate` to call `installSplashScreen()` BEFORE `super.onCreate(...)`:
```kotlin
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        tokenStore.loadSync()?.let { appState.toRunning(it.deviceId) }
        setContent { SignageRoot(appState) }
    }
```

- [ ] **Step 2: Build the debug APK**

Run: `cd android-tv && ./gradlew :app:assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt
git commit -m "feat(android): MainActivity installs splash screen pre-super (Plan 5 Task 14)"
```

---

## Task 15: `InitialSyncOverlay` composable

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/running/InitialSyncOverlay.kt`

- [ ] **Step 1: Implement**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/running/InitialSyncOverlay.kt
// Plan 5 Phase 2 Task 15.
// Branded "syncing menu..." overlay shown by RunningScreen when the device
// has no playable media yet (initial sync after pairing or after cache wipe).
// Hides as soon as PlaybackDirector advances into a Playing/Preparing state.
package com.ouie.signage.running

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.colorResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Text
import com.ouie.signage.R

@Composable
fun InitialSyncOverlay(message: String = "Syncing menu…") {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colorResource(id = R.color.brand_green)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Image(
                painter = painterResource(id = R.mipmap.ic_launcher_foreground),
                contentDescription = null,
                modifier = Modifier.size(192.dp),
            )
            CircularProgressIndicator(color = Color.White)
            Text(text = message, color = Color.White)
        }
    }
}
```

- [ ] **Step 2: Compile to verify**

Run: `cd android-tv && ./gradlew :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/running/InitialSyncOverlay.kt
git commit -m "feat(android): InitialSyncOverlay branded loading state (Plan 5 Task 15)"
```

---

## Task 16: Wire InitialSyncOverlay into RunningScreen

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/running/RunningScreen.kt`

- [ ] **Step 1: Read RunningScreen to understand its current structure**

Run: `cat android-tv/app/src/main/java/com/ouie/signage/running/RunningScreen.kt`

Locate where the `PlaybackState` is consumed. The intent: when state is `NoContent` AND no media file has yet been cached (i.e., we're still in initial sync), render `InitialSyncOverlay()` instead of any "no content" placeholder. After state transitions to `Preparing` or `Playing`, the existing playback hosts take over.

- [ ] **Step 2: Add the overlay branch**

The exact edit depends on RunningScreen's current shape. Add an `is NoContent ->` (or extend the existing one) branch in the `when` over `PlaybackState`:

```kotlin
            is PlaybackState.NoContent -> {
                val cacheCount = coordinator.cachePick.collectAsState().value
                    ?.let { (it.root.resolve("media").listFiles()?.size ?: 0) }
                    ?: 0
                if (cacheCount == 0) {
                    InitialSyncOverlay(message = "Syncing menu…")
                } else {
                    InitialSyncOverlay(message = "No content assigned")
                }
            }
```

(Engineer adapts the exact field accessor based on current RunningScreen wiring — `coordinator` is the RunningCoordinator obtained via Koin; the `cachePick` StateFlow is already exposed.)

- [ ] **Step 3: Build the debug APK**

Run: `cd android-tv && ./gradlew :app:assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/running/RunningScreen.kt
git commit -m "feat(android): RunningScreen shows InitialSyncOverlay during first sync (Plan 5 Task 16)"
```

---

# PHASE 3 — FCM Post-Reboot Mitigation

## Task 17: Migration — `devices.last_fcm_dispatch_*` columns

**Files:**
- Create: `supabase/migrations/20260424001100_devices_fcm_dispatch.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260424001100_devices_fcm_dispatch.sql
-- Plan 5 Phase 3 Task 17.
-- FCM dispatch outcome tracking. devices-sync-now stamps these on every send
-- so the dashboard can distinguish:
--   - last_fcm_dispatched_at AND last_fcm_received_at populated → roundtrip OK
--   - dispatched but no receipt within 60s → device socket likely stale
--   - last_fcm_dispatch_error populated → server-side problem (FCM rejected)
--
-- Note: this is single-state, NOT historical. A new dispatch overwrites the
-- previous one. Sufficient for 8 devices; revisit if we need a per-event audit
-- log.
ALTER TABLE devices
    ADD COLUMN last_fcm_dispatched_at timestamptz,
    ADD COLUMN last_fcm_dispatch_message_id text,
    ADD COLUMN last_fcm_dispatch_error text;

COMMENT ON COLUMN devices.last_fcm_dispatched_at IS
    'Timestamp of the most recent devices-sync-now FCM call attempt for this device. Stamped regardless of FCM HTTP outcome.';
COMMENT ON COLUMN devices.last_fcm_dispatch_message_id IS
    'FCM HTTP v1 messages:send response.name field on success (e.g. "projects/X/messages/0:1234"). NULL when dispatch failed.';
COMMENT ON COLUMN devices.last_fcm_dispatch_error IS
    'FCM error string when dispatch failed (HTTP status + body excerpt). NULL when dispatch succeeded.';
```

- [ ] **Step 2: Apply locally**

Run: `supabase db reset`
Expected: 27 migrations apply, no errors.

- [ ] **Step 3: Restart PostgREST**

Run: `docker restart supabase_rest_smart-tv-video-viewer`
Expected: container restarts.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260424001100_devices_fcm_dispatch.sql
git commit -m "feat(db): devices FCM dispatch outcome columns (Plan 5 Task 17)"
```

---

## Task 18: Edge Function — capture FCM response in `devices-sync-now`

**Files:**
- Modify: `supabase/functions/_shared/fcm.ts`
- Modify: `supabase/functions/devices-sync-now/index.ts`

- [ ] **Step 1: Change `sendFcmSync` return type**

Edit `supabase/functions/_shared/fcm.ts`. Add the result type:

```typescript
export type FcmDispatchResult =
    | { ok: true; messageId: string }
    | { ok: false; error: string };
```

Replace the `sendFcmSync` function body to return the result instead of throwing on FCM failure:

```typescript
export async function sendFcmSync(fcmToken: string): Promise<FcmDispatchResult> {
  const projectId = Deno.env.get("FCM_PROJECT_ID");
  if (!projectId) throw new Error("FCM_PROJECT_ID must be set");
  const at = await getAccessToken();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${at}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        data: { action: "sync" },
        android: { priority: "HIGH" },
      },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, error: `${res.status} ${txt.slice(0, 500)}` };
  }
  const body = await res.json().catch(() => ({}));
  const messageId = typeof body.name === "string" ? body.name : "";
  return { ok: true, messageId };
}
```

(Note: changes signature from `Promise<void>` to `Promise<FcmDispatchResult>` — internal API; only `devices-sync-now` calls this.)

- [ ] **Step 2: Update devices-sync-now to stamp dispatch columns**

Edit `supabase/functions/devices-sync-now/index.ts`. Find the existing FCM dispatch block:

```typescript
  // Fire-and-forget. We don't want to block the dashboard on FCM latency, but
  // we do want a breadcrumb when sends fail so silent delivery problems are
  // visible in edge-function logs.
  const results = await Promise.allSettled(targetTokens.map((t) => sendFcmSync(t)));
  for (const r of results) {
    if (r.status === "rejected") console.error("sendFcmSync rejected:", r.reason);
  }
  return new Response(null, { status: 202 });
```

Replace with:

```typescript
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
```

- [ ] **Step 3: Restart edge runtime**

Run: `docker restart supabase_edge_runtime_smart-tv-video-viewer`

- [ ] **Step 4: Manual smoke**

Trigger Sync Now from the dashboard against any paired device (or against a fake device with `fcm_token=null` — the function should still 202 but stamp `last_fcm_dispatch_error` since there's no token to send to → actually the loop just sends 0 results, leaving columns untouched; that's fine).

For a real send: target the existing TCL device. Verify `devices.last_fcm_dispatched_at` is stamped and `last_fcm_dispatch_message_id` populated:
```bash
psql -h localhost -p 54322 -U postgres -d postgres -c \
  "select id, last_fcm_dispatched_at, last_fcm_dispatch_message_id, left(last_fcm_dispatch_error,80) from devices where id='<device-id>'"
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/fcm.ts supabase/functions/devices-sync-now/index.ts
git commit -m "feat(fn): devices-sync-now stamps FCM dispatch outcome (Plan 5 Task 18)"
```

---

## Task 19: Dashboard — FCM card shows dispatch result

**Files:**
- Modify: `dashboard/app/(authed)/devices/[deviceId]/page.tsx` (or wherever the FCM card lives — engineer locates)

- [ ] **Step 1: Read the device detail page to find the FCM card**

Run: `grep -nE "(last_fcm|FCM|fcm_)" dashboard/app/\(authed\)/devices/\[deviceId\]/page.tsx`

Locate the card that currently shows `last_fcm_received_at` (the Plan 4 work).

- [ ] **Step 2: Extend the SELECT and the card markup**

Add the three new columns to the device fetch:
```typescript
.select("..., last_fcm_dispatched_at, last_fcm_dispatch_message_id, last_fcm_dispatch_error")
```

In the FCM card JSX, add a row below the existing receipt line:

```tsx
        <div className="grid grid-cols-[180px_1fr] gap-y-1 text-sm">
          <div className="text-slate-400">Last received</div>
          <div>{device.last_fcm_received_at ?? "—"}</div>
          <div className="text-slate-400">Last dispatched</div>
          <div>
            {device.last_fcm_dispatched_at
              ? device.last_fcm_dispatch_error
                ? <span className="text-red-400">{device.last_fcm_dispatched_at} — error: {device.last_fcm_dispatch_error}</span>
                : <span>{device.last_fcm_dispatched_at} — message <code className="font-mono text-xs">{device.last_fcm_dispatch_message_id}</code></span>
              : "—"}
          </div>
        </div>
```

(Engineer adapts to actual JSX style of surrounding card.)

- [ ] **Step 3: Smoke locally**

Visit `/devices/<id>` after triggering Sync Now. Expected: card shows both lines; dispatched timestamp matches what's in DB.

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/\(authed\)/devices/
git commit -m "feat(dash): device FCM card shows dispatch outcome (Plan 5 Task 19)"
```

---

## Task 20: Android — `FcmTokenSource.forceRefresh()`

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/fcm/FcmTokenSource.kt`

- [ ] **Step 1: Make the class `open` and add `open suspend fun forceRefresh()`**

Edit `android-tv/app/src/main/java/com/ouie/signage/fcm/FcmTokenSource.kt`. Change the class declaration from:
```kotlin
class FcmTokenSource(private val scope: CoroutineScope) {
```
to:
```kotlin
open class FcmTokenSource(private val scope: CoroutineScope) {
```

(Open is required so Task 21's test can subclass with a counting double. Constructor stays as-is — the production Koin `single` binding doesn't change.)

Add a new `open suspend fun` (placement: just below `prime()`):

```kotlin
    /**
     * Plan 5 Task 20: hard re-acquire the FCM token by deleting then re-fetching.
     * Side effect: GMS exercises the MTALK socket, which (per Plan 4.1 follow-up
     * hypothesis) may unstick a post-reboot scenario where the receive socket
     * fails to re-establish. Speculative — we cannot prove root cause without
     * ADB on the TCL TV, but the cost is one extra RPC per boot.
     *
     * Suspending: caller should await before issuing the first heartbeat, but
     * failures are silent (heartbeat carries the cached value, which may still
     * be the stale one — same behavior as before).
     *
     * Open so unit tests in Task 21 can subclass with a counting/throwing double.
     */
    open suspend fun forceRefresh() {
        try {
            suspendCancellableCoroutine<Unit> { cont ->
                FirebaseMessaging.getInstance().deleteToken()
                    .addOnSuccessListener { cont.resume(Unit) }
                    .addOnFailureListener { cont.resumeWithException(it) }
            }
            val fresh = awaitToken()
            cached = fresh
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            // Same swallow as prime() — heartbeat will carry cached or null.
        }
    }
```

- [ ] **Step 2: Compile**

Run: `cd android-tv && ./gradlew :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/fcm/FcmTokenSource.kt
git commit -m "feat(android): FcmTokenSource.forceRefresh exercises GMS path (Plan 5 Task 20)"
```

---

## Task 21: Android — HeartbeatScheduler triggers forceRefresh on first-after-boot

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt`
- Modify: `android-tv/app/src/test/java/com/ouie/signage/heartbeat/HeartbeatSchedulerTest.kt` (or create if absent — see Step 1)

- [ ] **Step 1: Check if HeartbeatSchedulerTest exists**

Run: `ls android-tv/app/src/test/java/com/ouie/signage/heartbeat/ 2>/dev/null`

If the test file exists, add a new test case to it. If not, create a new one with focused scope (just the first-after-boot logic).

- [ ] **Step 2: Add the test-only stubs file (production code not modified yet)**

Why first: the test in Step 3 needs these stubs to compile. Without them, the test fails to compile, not fails to assert — that's a less informative red.

Create `android-tv/app/src/test/java/com/ouie/signage/heartbeat/HeartbeatSchedulerStubs.kt`:

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/heartbeat/HeartbeatSchedulerStubs.kt
// Plan 5 Phase 3 Task 21 — minimal stubs so HeartbeatScheduler can be
// instantiated for narrow unit tests without standing up the real ConfigApi /
// ConfigStore / PlaybackDirector / HeartbeatApi graph. The stubs throw on
// every method that's not exercised by these tests, so accidental coverage
// expansion fails loudly.
package com.ouie.signage.heartbeat

import com.ouie.signage.net.HeartbeatApi
import com.ouie.signage.playback.PlaybackStateSnapshot
import com.ouie.signage.playback.PlaybackStateSource
import com.ouie.signage.preload.PreloadStatus
import com.ouie.signage.preload.PreloadStatusSource

internal object StubHeartbeatApi : HeartbeatApi {
    override suspend fun post(payload: HeartbeatPayload) {
        throw UnsupportedOperationException("stub: HeartbeatApi.post not exercised by these tests")
    }
}

internal object StubPlaybackStateSource : PlaybackStateSource {
    override fun snapshot(): PlaybackStateSnapshot = PlaybackStateSnapshot(null, "no_content")
}

internal object StubPreloadStatusSource : PreloadStatusSource {
    override fun current(): PreloadStatus? = null
}
```

For `ConfigRepository`, the engineer first runs `grep -n "class ConfigRepository\|interface ConfigApi" android-tv/app/src/main/java/com/ouie/signage/config/` to confirm the real constructor signature, then adds a minimal stub to the same file:

```kotlin
// Append to HeartbeatSchedulerStubs.kt — adapt to the real ConfigApi shape.
internal val StubConfigRepository: com.ouie.signage.config.ConfigRepository =
    com.ouie.signage.config.ConfigRepository(
        api = StubConfigApi,
        store = com.ouie.signage.config.ConfigStore(
            java.io.File(System.getProperty("java.io.tmpdir"), "stub-config-${System.nanoTime()}"),
            kotlinx.serialization.json.Json,
        ),
    )

private object StubConfigApi : com.ouie.signage.config.ConfigApi {
    // Engineer: match the EXACT signature of ConfigApi.fetch (return type may
    // be Response<ConfigResponse> or similar). Throw UnsupportedOperationException
    // — these tests do not invoke fetch.
    override suspend fun fetch(ifNoneMatch: String?): retrofit2.Response<com.ouie.signage.config.ConfigResponse> {
        throw UnsupportedOperationException("stub: ConfigApi.fetch not exercised by these tests")
    }
}
```

If the real `ConfigApi.fetch` signature differs (different parameter name, different return wrapper), the engineer adapts the override accordingly — the implementation body stays the same `throw`.

- [ ] **Step 3: Write the failing test**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/heartbeat/HeartbeatSchedulerFirstBootTest.kt
// Plan 5 Phase 3 Task 21 — TDD.
// Drives `maybeForceFcmRefresh()` in isolation — verifies the firstAfterBoot
// state machine without standing up the heartbeat-loop coroutine.
package com.ouie.signage.heartbeat

import com.ouie.signage.errorbus.ErrorBus
import com.ouie.signage.fcm.FcmReceiptTracker
import com.ouie.signage.fcm.FcmTokenSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import org.junit.Assert.assertEquals
import org.junit.Test

class HeartbeatSchedulerFirstBootTest {

    private class CountingTokenSource(scope: CoroutineScope) : FcmTokenSource(scope) {
        var forceRefreshCalls = 0
        override suspend fun forceRefresh() { forceRefreshCalls++ }
    }

    private fun newScheduler(tokenSource: FcmTokenSource): HeartbeatScheduler =
        HeartbeatScheduler(
            scope = CoroutineScope(Dispatchers.Unconfined),
            api = StubHeartbeatApi,
            configRepo = StubConfigRepository,
            skewTracker = ClockSkewTracker(),
            playlistSource = { null },
            pickProvider = { null },
            errorBus = ErrorBus(),
            fcmTokenSource = tokenSource,
            preloadStatusSource = StubPreloadStatusSource,
            fcmReceiptTracker = FcmReceiptTracker(),
            playbackStateSource = StubPlaybackStateSource,
            intervalMs = 60_000,
        )

    @Test fun `maybeForceFcmRefresh calls forceRefresh on first invocation only`() = runBlocking {
        val tokenScope = TestScope(UnconfinedTestDispatcher())
        val tokenSource = CountingTokenSource(tokenScope)
        val sched = newScheduler(tokenSource)

        sched.maybeForceFcmRefresh()
        sched.maybeForceFcmRefresh()
        sched.maybeForceFcmRefresh()

        assertEquals(1, tokenSource.forceRefreshCalls)
    }

    @Test fun `maybeForceFcmRefresh swallows forceRefresh failures`() = runBlocking {
        val tokenScope = TestScope(UnconfinedTestDispatcher())
        val throwing = object : FcmTokenSource(tokenScope) {
            override suspend fun forceRefresh() { throw RuntimeException("gms angry") }
        }
        val sched = newScheduler(throwing)
        // Should not propagate. If swallowed, return is normal; otherwise junit
        // reports the RuntimeException as the failure cause.
        sched.maybeForceFcmRefresh()
    }
}
```

- [ ] **Step 4: Run the test — expected to FAIL on compile**

Run: `cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.heartbeat.HeartbeatSchedulerFirstBootTest"`

Expected: compile error referencing `maybeForceFcmRefresh` — method doesn't exist yet on `HeartbeatScheduler`. (This is the red phase of TDD — the test cannot run because the symbol it depends on isn't defined.)

- [ ] **Step 5: Add the production code — `firstAfterBoot` flag + `maybeForceFcmRefresh()` method**

Edit `android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt`. Add a private mutable boolean field next to existing `private var job: Job?`:

```kotlin
    private var firstAfterBoot: Boolean = true
```

Add a new `internal suspend fun` just below `stop()`:

```kotlin
    /**
     * Plan 5 Task 21: speculative FCM-socket-stickiness mitigation. On the
     * first heartbeat after process start, force a token re-acquire — exercises
     * the GMS path which (per Plan 4.1 follow-up) may unstick post-reboot
     * scenarios where the receive socket fails to re-establish on TCL Google
     * TV. Subsequent calls are no-ops. Failures swallowed (we don't want one
     * bad GMS call to abort the heartbeat itself).
     *
     * Internal visibility so unit tests can drive this in isolation.
     */
    internal suspend fun maybeForceFcmRefresh() {
        if (!firstAfterBoot) return
        firstAfterBoot = false
        try {
            fcmTokenSource.forceRefresh()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            // Swallow — heartbeat will carry whatever cached() returns.
        }
    }
```

Modify `sendOne()` to call it at the very top (before the existing `val uptimeSeconds = ...`):

```kotlin
    private suspend fun sendOne() {
        maybeForceFcmRefresh()
        // ... rest of existing method body unchanged (uptimeSeconds, pick, etc.)
    }
```

- [ ] **Step 6: Run the test — green**

Run: `cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.heartbeat.HeartbeatSchedulerFirstBootTest"`
Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt \
        android-tv/app/src/test/java/com/ouie/signage/heartbeat/HeartbeatSchedulerFirstBootTest.kt \
        android-tv/app/src/test/java/com/ouie/signage/heartbeat/HeartbeatSchedulerStubs.kt
git commit -m "feat(android): force FCM token refresh before first heartbeat (Plan 5 Task 21)"
```

---

# PHASE 4 — Acceptance + Cutover

## Task 22: Bump version + redeploy edge functions to remote

**Files:**
- Modify: `android-tv/app/build.gradle.kts` (versionCode + versionName bump)

- [ ] **Step 1: Bump version**

Edit `android-tv/app/build.gradle.kts`. Find:
```kotlin
        versionCode = 7
        versionName = "0.4.1-p4"
```
Change to:
```kotlin
        versionCode = 8
        versionName = "0.5.0-p5"
```

- [ ] **Step 2: Build the release APK**

Run: `cd android-tv && ./gradlew :app:assembleDebug`
Expected: BUILD SUCCESSFUL. APK at `android-tv/app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 3: Deploy migrations and edge functions to remote**

Run:
```bash
pnpm dlx dotenv-cli -e .env.production -- supabase db push --include-all
```
Expected: 2 new migrations applied (`20260424001000_app_releases`, `20260424001100_devices_fcm_dispatch`).

Then deploy the new + modified edge functions:
```bash
pnpm dlx dotenv-cli -e .env.production -- supabase functions deploy \
  apk-upload-url apk-publish devices-config devices-sync-now
```
Expected: 4 functions reported as deployed.

- [ ] **Step 4: Verify remote schema**

Run:
```bash
pnpm dlx dotenv-cli -e .env.production -- bash -c \
  'psql "$DATABASE_URL" -c "select column_name from information_schema.columns where table_name=\"tenants\" and column_name like \"latest_apk%\""'
```
Expected: 5 column names returned.

- [ ] **Step 5: Commit version bump**

```bash
git add android-tv/app/build.gradle.kts
git commit -m "chore(android): bump to 0.5.0-p5 + deploy Plan 5 functions to remote (Plan 5 Task 22)"
```

---

## Task 23: Real-hardware acceptance protocol on TCL TV

**Files:**
- None (this task is verification only — no code changes)

This is the live acceptance against the existing TCL TV (`ddd30eae-36ea-414f-b7fb-9713a58f79fb`). The plan's success criteria for Plan 5 are validated here.

- [ ] **Step 1: Manual sideload of new APK 0.5.0-p5 (last manual install ever)**

Per existing F&B operator pattern: USB stick + CX File Explorer. Copy `app-debug.apk` to USB → plug into TCL TV → CX File Explorer → tap APK → confirm install. Verify launch shows the brand-green splash screen with the white "Ouie!" foreground icon, briefly, before transitioning into Pairing or Running screen.

- [ ] **Step 2: Re-pair if device row was wiped during install OR confirm continuity if not**

If the install kept tokens (likely, since same applicationId): existing device `ddd30eae-...` continues. Verify heartbeat resumes within 60s on dashboard at https://signage-ouie.vercel.app.

- [ ] **Step 3: Visual verification — banner + icon + splash**

- Press TV remote HOME → return to Google TV launcher → confirm "Signage" tile shows the green banner with white "ouie" wordmark (NOT a slate rectangle).
- Open Settings → Apps → All apps → confirm "Signage" icon shows the green circle with white "Ouie!" wordmark.
- Force-stop the app via Settings → Open via launcher → confirm the brand-green splash screen flashes briefly (Android 12+ behavior) before content loads.

- [ ] **Step 4: OTA round-trip — publish 0.5.1 from dashboard, verify auto-install**

Bump versionCode to 9 and versionName to "0.5.1-p5-ota" in `android-tv/app/build.gradle.kts`, rebuild (`./gradlew :app:assembleDebug`), then go to https://signage-ouie.vercel.app/app-releases and upload the new APK with versionCode=9, versionName="0.5.1-p5-ota". Wait up to 60s for the next config poll on the TV. Expected: TV downloads APK, system "Install update?" dialog appears, operator confirms via remote dpad → app reinstalls → on relaunch, the heartbeat reports `app_version: "0.5.1-p5-ota"` on the dashboard.

If `canRequestPackageInstalls()` denies (Install unknown apps not granted for our package): `device_error_events` row appears with `kind: "ota_install_blocked"` and the human-readable message. Operator goes to Settings → Apps → Special access → Install unknown apps → Signage → enable. Future updates auto-install without re-prompt.

- [ ] **Step 5: FCM mitigation — observability check**

Trigger Sync Now from the dashboard. On the device detail page, confirm:
- "Last dispatched" shows current timestamp + a non-empty `messageId` (server-side dispatch succeeded).
- "Last received" updates within 60s (cycle 1 boot may carry stale; cycle 2 should have fresh post-forceRefresh).

Reboot the TCL TV. After ~90s, confirm `SignageService` heartbeat resumes (existing Plan 3c behavior). Trigger Sync Now from dashboard. Expected: "Last dispatched" stamps; "Last received" populates within ~60s. If "Last received" stays stale for >5 min, the speculative fix didn't help — note in CLAUDE.md follow-ups and keep ADB-attempt as the path forward.

- [ ] **Step 6: Document the run**

Append acceptance notes to `CLAUDE.md` Status block at the top: "Plan 5 shipped — OTA self-install + brand polish + FCM forceRefresh mitigation" with concrete observations from Steps 3–5 (banner shows, OTA round-trip succeeded, FCM dispatch outcomes visible). If the FCM mitigation didn't work, note that explicitly so future sessions don't assume it did.

- [ ] **Step 7: Commit acceptance notes**

```bash
git add CLAUDE.md
git commit -m "docs(claude): Plan 5 shipped — OTA + brand polish + FCM mitigation real-hardware acceptance"
```

---

# Self-Review (run after writing — fix issues inline)

**Spec coverage** — Plan 5's three goals from the architecture summary:
- ✅ OTA — Tasks 1–10 cover DB pointer, upload endpoint, publish endpoint, config extension, dashboard upload UX, Android UpdateChecker + PackageInstaller wiring.
- ✅ Cosmetic polish — Tasks 11–16 cover banner asset generation, adaptive icon, splash theme, MainActivity hookup, InitialSyncOverlay.
- ✅ FCM mitigation — Tasks 17–21 cover DB column, server-side dispatch capture, dashboard surface, device-side forceRefresh, HeartbeatScheduler first-after-boot trigger.
- ✅ Acceptance — Tasks 22–23 cover version bump, remote deploy, real-hardware verification.

**Placeholder scan:**
- Task 21 Step 2 includes a `StubConfigApi.fetch` whose exact signature is "engineer adapts to actual ConfigApi shape" — this is a directive to verify a real type, not a placeholder for missing code. The implementation body (`throw UnsupportedOperationException`) is concrete and complete. Acceptable.
- Task 16 Step 2 says "engineer adapts the exact field accessor based on current RunningScreen wiring" — same pattern. The `cacheCount == 0` decision logic and overlay invocation are concrete; only the property-access path needs to match current naming.
- Task 5 Step 4 says "engineer locates" the nav component — Plan 4-era pattern. Acceptable.
- Task 19 Step 1 says "engineer adapts to actual JSX style" — same. Acceptable.
- No "TODO", "implement later", or "fill in details" markers anywhere.

**Type consistency:**
- `Release.version_code` (Int) used in UpdateChecker matches `AppReleaseDto.version_code` (Int) from ConfigResponse. ✅
- `app_release` field name is consistent across server payload, ConfigResponse, and UpdateChecker. ✅
- `ApkInstaller` interface defined in UpdateChecker.kt (Task 8) and implemented in PackageInstallerHelper.kt (Task 9). ✅
- Koin binding uses `bind ApkInstaller::class` pattern — engineer to confirm AppModule.kt syntax matches this; existing module uses `single<X> { Y(...) }` syntax which works equivalently.

**Numeric thresholds:**
- 200 MB APK ceiling (Task 2): cited as "typical Android TV APK is 30–80 MB; this leaves headroom for native libs and bundled fonts." Reasoned, not invented.
- 10-min upload TTL (Task 2): same as `media-upload-url` (precedent). ✅
- 24h presigned GET TTL (Task 4): same as media (precedent). ✅
- 64KB read buffer (Task 8 sha256Hex, Task 9 install): standard buffer size, not load-bearing. ✅
- All other timing references use existing constants (`intervalMs = 60_000` for heartbeat, etc.).

No hidden gut-feel numbers. Self-review passes.

---

# Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-24-plan-5-ota-and-cosmetic-polish.md`. 23 tasks across 4 phases. Estimated 1.5–2.5 iteration days based on Plan-3-series velocity (TDD'd Edge Functions ~10 min each; Android TDD'd Kotlin classes ~15 min each; cosmetic asset task is single-shot Python; cosmetic Android wiring is shallow Compose; real-hardware acceptance is the longest tail).

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Matches the pattern used for Plans 3b/3c/4/4.1.

2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
