# Plan 3c — Android TV APK: FCM + boot + hardening + preload + LRU + error bus

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the emulator-only Plan 3b APK into a production-ready one. After this plan, (a) FCM "Sync Now" pushes from the dashboard cut sync-latency from ≤ 60 s to ≤ a few seconds; (b) `BOOT_COMPLETED` + foreground service auto-launch and keep playback alive through TV reboots and OS pressure; (c) LRU eviction prevents cache from filling the disk; (d) preload-via-USB lets operators sneakernet content to stores with bad connectivity; (e) an on-device error bus ships playback + download failures in the heartbeat payload (spec §8). Real-hardware acceptance pass on one physical TV closes out the plan.

**Architecture:** The Plan 3b `RunningCoordinator` — which currently lives inside the `MainActivity` process lifecycle — moves into a foreground `SignageService`. `MainActivity` starts/stops the service via `startForegroundService` / `stopService`. `BootReceiver` listens for `BOOT_COMPLETED` + `QUICKBOOT_POWERON` and starts the service directly (TVs that allow it also get an Activity launch; if OS restrictions block the Activity, service keeps playback going and operator can hit Home → Signage Player). A new `SignageMessagingService` (Firebase's `FirebaseMessagingService`) receives data messages with `action: "sync"` and calls `RunningCoordinator.triggerSyncNow()`. FCM token is surfaced via a new `FcmTokenSource` that reads `FirebaseMessaging.getInstance().token` lazily and folds it into the heartbeat payload — the Plan-1 `devices-heartbeat` Edge Function gets a one-line extension to write it to `devices.fcm_token`. `CacheEvictor` is a pure-logic helper invoked by `MediaDownloader` before each download via a `cache.ensureFreeSpaceFor(bytes)` hook. `PreloadScanner` walks `<cache_root>/../preload/` at coordinator start + every sync-window boundary, uses `preload_index.db` (a second SQLite table) to skip unchanged files, and atomically moves checksum-matched files into the cache. The error bus (`ErrorBus`) is a thread-safe bounded-queue that `HeartbeatScheduler` drains into the payload.

**Tech Stack:** Same as 3b (Kotlin 2.1, Compose for TV, OkHttp 4 / Retrofit 2 / kotlinx.serialization, Koin 4, Media3 1.5.1) plus Firebase BOM 33.x + firebase-messaging for FCM, `com.google.gms.google-services` Gradle plugin, `androidx.core:core-ktx` `NotificationCompat` for the foreground service notification. No new server-side dependencies — `_shared/fcm.ts` and `devices-sync-now` already exist and will be consumed unchanged (except for one Edge Function redeploy to pick up the new `fcm_token` write in `devices-heartbeat`).

**Out of scope for 3c (deferred or explicitly post-v1):**
- Server-side persistence of `errors_since_last_heartbeat` into a `device_error_events` table + dashboard "Recent errors" card. Device emits errors in the heartbeat payload per spec §8; server currently ignores unknown keys. Persistence is a follow-up plan (~6 tasks: migration + Edge Function write + dashboard card).
- Automatic APK updates via R2-hosted version file (spec §11 calls this v1.1).
- Signed preload manifests (spec §11, v1.1 — we use raw checksum-match in 3c).
- Live USB cache migration (evaluate-at-startup only, matching spec §11 v1).
- WhatsApp bot for media upload (post-v1).
- FCM delivery observability / retry logic — fire-and-forget per spec §6.4 acceptability statement.
- Dashboard changes beyond what's already rendered — heartbeat observability (app_version, clock_skew, cache storage) already lands on the device-detail page.

**Execution branch:** new branch `feature/plan-3c-android-hardening` off `main` (Plan 3b merged at a7df868).

**End-of-plan commit:** `feat(android): plan 3c — FCM + boot + hardening + preload + LRU + error bus live`

---

## Prerequisites — user must complete before Task 4.1

All device-side prerequisites from Plan 3a (Android Studio, emulator, adb) still apply. The new one is Firebase:

1. **Firebase project with an Android app.** In `console.firebase.google.com`:
   - Create a new project (or reuse an existing one) — name suggestion: `ouie-signage`.
   - Click "Add app" → Android.
   - Package name: **`com.ouie.signage.debug`** (the debug applicationId; the release APK uses `com.ouie.signage` without the suffix). For now we only need the debug variant; register the release package in a second Add-app pass when preparing for release.
   - App nickname: `Signage TV Debug`.
   - No SHA-1 needed for FCM (only needed for Dynamic Links / other services).
   - Download `google-services.json`.

2. **Place `google-services.json` in `android-tv/app/`.** The file is gitignored in this plan's Task 0.1 — never commit it.

3. **Verify FCM service account is already configured on the server.** Per CLAUDE.md, `FCM_SERVICE_ACCOUNT_JSON` + `FCM_PROJECT_ID` are already set as Supabase secrets (from Plan 1 / Plan 2). If the Firebase project chosen in step 1 is a NEW project, the existing server secrets point to a different project and won't deliver — you'll need to either (a) reuse the existing project from the secrets or (b) regenerate the server secrets for the new project via `supabase secrets set FCM_SERVICE_ACCOUNT_JSON="$(cat service-account.json)" FCM_PROJECT_ID=<new-project-id>`.

**Agent check before starting Task 4.1:**
```bash
ls android-tv/app/google-services.json    # must exist
grep -o "project_id" android-tv/app/google-services.json     # confirms it's real JSON
```
If either fails, STOP and ask the user to complete the Firebase setup.

**Real-hardware prerequisites (for Phase 7 only):**

4. **One physical Android TV available.** Operator enables USB debugging + LAN ADB (Settings → Device Preferences → About → tap Build 7 times → Developer options → ADB debugging ON). TV and the Mac share a LAN. Test connectivity: `adb connect <tv-ip>:5555` succeeds.

5. **A USB stick (optional, for Phase 3 preload test).** Formatted exFAT (preferred) or FAT32. Minimum 4 GB. The stick must be writable by the Mac to seed preload files.

---

## File structure

All additions are inside `android-tv/app/src/main/java/com/ouie/signage/`.

```
com/ouie/signage/
├── error/                             # MOVED NAMESPACE (Plan 3a had error/ErrorScreen.kt; keep that)
│   └── ErrorScreen.kt                 # unchanged (from Plan 3a)
├── errorbus/                          # NEW
│   ├── ErrorBus.kt                    # bounded in-memory queue + report/drain API
│   └── ErrorEvent.kt                  # @Serializable event shape matching spec §8
├── cache/                             # extended
│   ├── CacheLayout.kt                 # unchanged (from Plan 3b)
│   ├── CacheRootResolver.kt           # unchanged (from Plan 3b)
│   ├── Checksum.kt                    # unchanged (from Plan 3b)
│   ├── MediaCacheIndex.kt             # unchanged (from Plan 3b)
│   ├── CacheManager.kt                # MODIFIED — adds ensureFreeSpaceFor(bytes): Boolean
│   └── CacheEvictor.kt                # NEW — LRU pure logic
├── preload/                           # NEW
│   ├── PreloadIndex.kt                # SQLite (path, size, mtime, sha256) with cached_at
│   ├── PreloadScanner.kt              # scans preload dir, atomic-moves matched files
│   └── PreloadStatus.kt               # @Serializable summary for heartbeat cache_storage_info
├── fcm/                               # NEW
│   ├── SignageMessagingService.kt     # FirebaseMessagingService subclass
│   ├── FcmTokenSource.kt              # lazy wrapper around FirebaseMessaging.token
│   └── SyncNowBroadcast.kt            # single broadcast channel the coordinator listens on
├── service/                           # NEW
│   ├── SignageService.kt              # foreground service; owns RunningCoordinator lifetime
│   └── ServiceNotification.kt         # small helper to build the persistent notification
├── boot/                              # NEW
│   └── BootReceiver.kt                # BOOT_COMPLETED + QUICKBOOT_POWERON receiver
├── coordinator/
│   └── RunningCoordinator.kt          # MODIFIED — add triggerSyncNow(), register ErrorBus, wire Evictor + Preload + FCM
├── heartbeat/
│   ├── HeartbeatPayload.kt            # MODIFIED — add `errors_since_last_heartbeat` + `fcm_token` fields; PreloadStatus embedded in CacheStorageInfo
│   ├── HeartbeatScheduler.kt          # MODIFIED — drain ErrorBus + pull fcm_token on each tick
│   └── (others unchanged)
├── sync/
│   ├── MediaDownloader.kt             # MODIFIED — ensureFreeSpaceFor() before write
│   └── (others unchanged)
├── MainActivity.kt                    # MODIFIED — delegate coordinator control to SignageService
├── SignageApp.kt                      # MODIFIED — register Firebase
├── AndroidManifest.xml                # MODIFIED — add receiver, service, permissions, banner
└── di/
    └── AppModule.kt                   # MODIFIED — register ErrorBus, CacheEvictor, FcmTokenSource, SignageService-related singles
```

**New tests (JVM, `src/test/java/com/ouie/signage/`):**

```
errorbus/
  ErrorBusTest.kt                      // report, drain, bounded-size behavior, concurrent access
cache/
  CacheEvictorTest.kt                  // sort by last_played_at, delete only non-referenced, stop at target free bytes
preload/
  PreloadScannerMatchTest.kt           // pure logic: given (index-entry or fresh-hash) + config media list → what's a match?
```

**Server side:** one edit + one redeploy.

- `supabase/functions/devices-heartbeat/index.ts` — add an `fcm_token` write + optional `errors_since_last_heartbeat` pass-through (logged, not persisted in 3c).
- Redeploy via `pnpm dlx dotenv-cli -e .env.production -- supabase functions deploy devices-heartbeat`.

**Dashboard:** no changes in 3c.

**Modified:**
- `CLAUDE.md` — status + 3c conventions.
- `.gitignore` — add `google-services.json`.

---

# Phase 0 — Branch + Firebase Gradle plugin wiring

Goal: the project compiles with Firebase on the classpath and `google-services.json` is excluded from git. No behavioral change yet.

### Task 0.1 — Create branch + .gitignore google-services.json

**Files:**
- Modify: repo-root `.gitignore`
- Modify: `android-tv/app/.gitignore`

- [ ] **Step 1: Create the execution branch**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feature/plan-3c-android-hardening
```

- [ ] **Step 2: Add the ignore entries**

Append to `android-tv/app/.gitignore`:

```
google-services.json
```

Append to repo-root `.gitignore` (if there isn't already one there for this path):

```
android-tv/app/google-services.json
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore android-tv/app/.gitignore
git commit -m "chore(android): gitignore google-services.json"
```

### Task 0.2 — Add Firebase + google-services plugin to version catalog

**Files:**
- Modify: `android-tv/gradle/libs.versions.toml`

- [ ] **Step 1: Extend the catalog**

Open `android-tv/gradle/libs.versions.toml`. In `[versions]` add:

```toml
firebaseBom = "33.5.1"
googleServices = "4.4.2"
```

In `[libraries]` add:

```toml
firebase-bom = { module = "com.google.firebase:firebase-bom", version.ref = "firebaseBom" }
firebase-messaging = { module = "com.google.firebase:firebase-messaging" }
```

In `[plugins]` add:

```toml
google-services = { id = "com.google.gms.google-services", version.ref = "googleServices" }
```

- [ ] **Step 2: Build to verify the catalog is still valid**

```bash
cd android-tv && ./gradlew :app:help 2>&1 | tail -3
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add android-tv/gradle/libs.versions.toml
git commit -m "chore(android): add Firebase BOM + messaging + google-services plugin to catalog"
```

### Task 0.3 — Apply the google-services plugin + Firebase dependency

**Files:**
- Modify: `android-tv/build.gradle.kts` (root)
- Modify: `android-tv/app/build.gradle.kts`

- [ ] **Step 1: Root build.gradle.kts — declare the google-services plugin**

At the top of `android-tv/build.gradle.kts`, inside the `plugins { }` block, add the `apply false` line so submodules can opt in:

```kotlin
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.google.services) apply false
}
```

- [ ] **Step 2: App module `android-tv/app/build.gradle.kts` — apply the plugin + add the dep**

In the `plugins { }` block at the top:

```kotlin
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.google.services)
}
```

In the `dependencies { }` block, add:

```kotlin
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
```

- [ ] **Step 3: Build verification**

This step will fail unless the user has placed `android-tv/app/google-services.json`. Prompt them now if it isn't present:

```bash
test -f android-tv/app/google-services.json \
    && echo "OK" \
    || echo "STOP: place google-services.json in android-tv/app/ per Prerequisites."
```

If OK, build:

```bash
cd android-tv && ./gradlew :app:assembleDebug 2>&1 | tail -5
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Commit**

```bash
git add android-tv/build.gradle.kts android-tv/app/build.gradle.kts
git commit -m "feat(android): apply google-services plugin + firebase-messaging dep"
```

---

# Phase 1 — Error bus + heartbeat integration

Goal: a bounded in-memory queue the rest of the app can report errors into; `HeartbeatScheduler` drains and ships them per spec §8.

### Task 1.1 — `ErrorEvent.kt` + `ErrorBus.kt`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/errorbus/ErrorEvent.kt`
- Create: `android-tv/app/src/main/java/com/ouie/signage/errorbus/ErrorBus.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/errorbus/ErrorBusTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/errorbus/ErrorBusTest.kt
package com.ouie.signage.errorbus

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.util.concurrent.Executors

class ErrorBusTest {

    @Test
    fun `drain returns reported events in insertion order`() {
        val bus = ErrorBus(capacity = 100, clock = { Instant.parse("2026-04-23T00:00:00Z") })
        bus.report(kind = "download_failed", mediaId = "m1", message = "timeout")
        bus.report(kind = "playback_failed", mediaId = "m2", message = "codec")
        val drained = bus.drain()
        assertEquals(2, drained.size)
        assertEquals("download_failed", drained[0].kind)
        assertEquals("m1", drained[0].media_id)
        assertEquals("playback_failed", drained[1].kind)
        assertEquals("2026-04-23T00:00:00Z", drained[0].timestamp)
    }

    @Test
    fun `drain empties the queue`() {
        val bus = ErrorBus(capacity = 100)
        bus.report(kind = "x", mediaId = null, message = "y")
        assertEquals(1, bus.drain().size)
        assertEquals(0, bus.drain().size)
    }

    @Test
    fun `exceeding capacity drops the oldest events`() {
        val bus = ErrorBus(capacity = 3)
        bus.report(kind = "a", mediaId = null, message = null)
        bus.report(kind = "b", mediaId = null, message = null)
        bus.report(kind = "c", mediaId = null, message = null)
        bus.report(kind = "d", mediaId = null, message = null)
        val drained = bus.drain()
        assertEquals(3, drained.size)
        assertEquals(listOf("b", "c", "d"), drained.map { it.kind })
    }

    @Test
    fun `concurrent reports from many threads never lose or corrupt events`() {
        val bus = ErrorBus(capacity = 10_000)
        val pool = Executors.newFixedThreadPool(8)
        val total = 1_000
        val latch = java.util.concurrent.CountDownLatch(total)
        repeat(total) { i ->
            pool.submit {
                bus.report(kind = "k", mediaId = "m$i", message = null)
                latch.countDown()
            }
        }
        latch.await()
        pool.shutdown()
        assertEquals(total, bus.drain().size)
    }
}
```

- [ ] **Step 2: Run the test — expect RED**

```bash
cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.errorbus.ErrorBusTest"
```

Expected: unresolved references `ErrorBus`, `ErrorEvent`.

- [ ] **Step 3: Write `ErrorEvent.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/errorbus/ErrorEvent.kt
package com.ouie.signage.errorbus

import kotlinx.serialization.Serializable

/**
 * Spec §8 `errors_since_last_heartbeat` shape. Sent to the server as part of
 * the heartbeat payload; in 3c the server ignores unknown keys, so this is
 * client-only observability until a future plan persists it.
 */
@Serializable
data class ErrorEvent(
    val timestamp: String,      // ISO-8601 UTC
    val kind: String,           // "download_failed" | "playback_failed" | ...
    val media_id: String?,
    val message: String?,
)
```

- [ ] **Step 4: Write `ErrorBus.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/errorbus/ErrorBus.kt
package com.ouie.signage.errorbus

import java.time.Clock
import java.time.Instant
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Thread-safe bounded FIFO of error events. When the queue is full, the oldest
 * event is dropped to make room for the newest — matches operator intuition
 * ("tell me what just went wrong, not what failed an hour ago").
 *
 * `drain()` atomically empties the queue. Meant to be called once per heartbeat
 * tick so events between ticks are shipped, then reset.
 */
class ErrorBus(
    private val capacity: Int = 32,
    private val clock: () -> Instant = { Instant.now(Clock.systemUTC()) },
) {

    private val lock = ReentrantLock()
    private val buffer = ArrayDeque<ErrorEvent>(capacity)

    fun report(kind: String, mediaId: String?, message: String?) {
        lock.withLock {
            if (buffer.size >= capacity) buffer.removeFirst()
            buffer.addLast(
                ErrorEvent(
                    timestamp = clock().toString(),
                    kind = kind,
                    media_id = mediaId,
                    message = message?.take(500),
                ),
            )
        }
    }

    fun drain(): List<ErrorEvent> = lock.withLock {
        val snapshot = buffer.toList()
        buffer.clear()
        snapshot
    }
}
```

- [ ] **Step 5: Run the test — expect GREEN (4 passed)**

```bash
cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.errorbus.ErrorBusTest"
```

- [ ] **Step 6: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/errorbus/ \
        android-tv/app/src/test/java/com/ouie/signage/errorbus/
git commit -m "feat(android): ErrorBus — bounded FIFO of spec §8 error events, thread-safe drain"
```

### Task 1.2 — Wire `ErrorBus` into `HeartbeatPayload` + `HeartbeatScheduler`

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatPayload.kt`
- Modify: `android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt`

- [ ] **Step 1: Extend `HeartbeatPayload.kt` with `errors_since_last_heartbeat`**

Replace the existing data class with:

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatPayload.kt
package com.ouie.signage.heartbeat

import com.ouie.signage.errorbus.ErrorEvent
import kotlinx.serialization.Serializable

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
)

@Serializable
data class CacheStorageInfo(
    val root: String,
    val filesystem: String,
    val total_bytes: Long,
    val free_bytes: Long,
    val updated_at: String,
    val degraded: Boolean = false,
    /**
     * Preload summary (spec §4 JSONB shape). Absent in 3b's heartbeat; populated
     * in 3c once PreloadScanner has a last result. Null when the scanner hasn't
     * run or the preload folder isn't present.
     */
    val preload: com.ouie.signage.preload.PreloadStatus? = null,
)
```

- [ ] **Step 2: Update `HeartbeatScheduler.kt` to drain the bus + include fcm_token**

Open `HeartbeatScheduler.kt`. Replace the existing constructor + `sendOne()` with:

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt
package com.ouie.signage.heartbeat

import android.os.SystemClock
import com.ouie.signage.BuildConfig
import com.ouie.signage.cache.CacheRootResolver
import com.ouie.signage.config.ConfigRepository
import com.ouie.signage.errorbus.ErrorBus
import com.ouie.signage.fcm.FcmTokenSource
import com.ouie.signage.net.HeartbeatApi
import com.ouie.signage.preload.PreloadStatusSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

fun interface CurrentPlaylistSource {
    fun current(): String?
}

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
    private val intervalMs: Long = 60_000,
) {

    private var job: Job? = null
    private val processStartRealtime = SystemClock.elapsedRealtime()

    fun start() {
        if (job?.isActive == true) return
        job = scope.launch {
            while (true) {
                sendOne()
                try { delay(intervalMs) } catch (e: CancellationException) { throw e }
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    private suspend fun sendOne() {
        val uptimeSeconds = (SystemClock.elapsedRealtime() - processStartRealtime) / 1000
        val pick = pickProvider()
        val cacheInfo = pick?.let {
            CacheStorageInfoBuilder.buildFrom(it, preloadStatusSource.current())
        }
        val errors = errorBus.drain()
        val fcm = fcmTokenSource.current()
        val payload = HeartbeatPayload(
            app_version = BuildConfig.VERSION_NAME,
            uptime_seconds = uptimeSeconds,
            current_playlist_id = playlistSource.current(),
            last_config_version_applied = configRepo.current.value?.version,
            clock_skew_seconds_from_server = skewTracker.current(),
            cache_storage_info = cacheInfo,
            errors_since_last_heartbeat = errors,
            fcm_token = fcm,
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

Note: `CacheStorageInfoBuilder.buildFrom` now takes an extra `PreloadStatus?` argument. That signature change lives in Task 3.4 (Preload phase) — for now create a stub fall-through by modifying `CacheStorageInfoBuilder.kt`:

Open `android-tv/app/src/main/java/com/ouie/signage/heartbeat/CacheStorageInfoBuilder.kt` and replace:

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/heartbeat/CacheStorageInfoBuilder.kt
package com.ouie.signage.heartbeat

import android.os.StatFs
import com.ouie.signage.cache.CacheRootResolver
import com.ouie.signage.preload.PreloadStatus
import java.time.Instant

object CacheStorageInfoBuilder {
    fun buildFrom(pick: CacheRootResolver.Pick, preload: PreloadStatus? = null): CacheStorageInfo {
        val stats = try { StatFs(pick.root.absolutePath) } catch (_: Throwable) { null }
        val totalBytes = stats?.let { it.blockCountLong * it.blockSizeLong } ?: 0L
        val freeBytes  = stats?.let { it.availableBlocksLong * it.blockSizeLong } ?: pick.freeBytes

        return CacheStorageInfo(
            root = if (pick.kind == CacheRootResolver.Kind.External) "external" else "internal",
            filesystem = "unknown",
            total_bytes = totalBytes,
            free_bytes = freeBytes,
            updated_at = Instant.now().toString(),
            degraded = pick.degraded,
            preload = preload,
        )
    }
}
```

This file won't compile until the `preload` package exists (Task 3.1 creates it). That's OK — we'll implement in-order so by the time we assemble, dependencies are satisfied.

- [ ] **Step 3: Do NOT build yet** — the scheduler references `FcmTokenSource` + `PreloadStatusSource` which don't exist. Commit the modification and return to Phase 2.

```bash
git add android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatPayload.kt \
        android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt \
        android-tv/app/src/main/java/com/ouie/signage/heartbeat/CacheStorageInfoBuilder.kt
git commit -m "feat(android): Heartbeat — include errors_since_last_heartbeat + fcm_token + preload fields"
```

Build verification is deferred to Task 3.5 when all referenced types exist.

---

# Phase 2 — LRU eviction

Goal: before each download, ensure the cache has enough free space by evicting oldest non-referenced files.

### Task 2.1 — `CacheEvictor.kt` (pure logic, TDD)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/cache/CacheEvictor.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/cache/CacheEvictorTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/cache/CacheEvictorTest.kt
package com.ouie.signage.cache

import org.junit.Assert.assertEquals
import org.junit.Test

class CacheEvictorTest {

    private fun row(id: String, sizeBytes: Long, lastPlayed: Long?): MediaCacheIndex.Entry =
        MediaCacheIndex.Entry(
            mediaId = id, ext = "mp4", checksum = "x", sizeBytes = sizeBytes,
            cachedAtEpochSeconds = 0L, lastPlayedAtEpochSeconds = lastPlayed,
        )

    @Test
    fun `picks no candidates when enough free already`() {
        val plan = CacheEvictor.plan(
            currentFreeBytes = 5_000_000,
            neededBytes = 1_000_000,
            safetyMargin = 100_000,
            cached = listOf(row("a", 1_000_000, 100)),
            referencedMediaIds = setOf("a"),
        )
        assertEquals(emptyList<String>(), plan.toEvict)
        assertEquals(true, plan.sufficient)
    }

    @Test
    fun `evicts oldest non-referenced first`() {
        val plan = CacheEvictor.plan(
            currentFreeBytes = 100_000,
            neededBytes = 1_000_000,
            safetyMargin = 100_000,
            cached = listOf(
                row("new", 500_000, lastPlayed = 200),
                row("mid", 600_000, lastPlayed = 100),
                row("old", 700_000, lastPlayed = 50),
            ),
            referencedMediaIds = setOf("new"),
        )
        // Need 1_100_000 total. Currently 100_000 free. Must free 1_000_000.
        // Non-referenced: mid + old. Oldest first = old (700_000). After evicting old, free = 800_000.
        // Still short, evict mid (600_000). Free = 1_400_000. Stop.
        assertEquals(listOf("old", "mid"), plan.toEvict)
        assertEquals(true, plan.sufficient)
    }

    @Test
    fun `never evicts referenced media even if needed would require it`() {
        val plan = CacheEvictor.plan(
            currentFreeBytes = 0,
            neededBytes = 1_000_000,
            safetyMargin = 100_000,
            cached = listOf(row("ref", 500_000, 50)),
            referencedMediaIds = setOf("ref"),
        )
        assertEquals(emptyList<String>(), plan.toEvict)
        assertEquals(false, plan.sufficient)   // can't make enough room
    }

    @Test
    fun `uses cached_at as tiebreaker when last_played_at is null`() {
        // Unplayed rows (lastPlayed == null) sort before played rows by cached_at.
        val plan = CacheEvictor.plan(
            currentFreeBytes = 0,
            neededBytes = 500_000,
            safetyMargin = 0,
            cached = listOf(
                MediaCacheIndex.Entry("a", "mp4", "x", 300_000, cachedAtEpochSeconds = 100, lastPlayedAtEpochSeconds = null),
                MediaCacheIndex.Entry("b", "mp4", "x", 300_000, cachedAtEpochSeconds = 50, lastPlayedAtEpochSeconds = null),
            ),
            referencedMediaIds = emptySet(),
        )
        assertEquals(listOf("b", "a"), plan.toEvict)
    }
}
```

- [ ] **Step 2: Run — expect RED**

- [ ] **Step 3: Implement `CacheEvictor.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/cache/CacheEvictor.kt
package com.ouie.signage.cache

/**
 * Pure-logic eviction planner. Given the current free bytes on disk, how many
 * bytes a pending download needs, a safety margin, and the full set of cached
 * rows + currently-referenced media ids, compute which rows to delete to
 * satisfy `currentFreeBytes - sumEvicted >= neededBytes + safetyMargin`.
 *
 * Rules:
 *   - Never evict referenced media (would force an immediate re-download).
 *   - Among eligible candidates, evict oldest first (last_played_at ascending,
 *     then cached_at ascending for never-played items).
 *   - If the candidate pool can't free enough, return what we have + sufficient=false.
 *     Caller decides whether to download anyway (fails later) or abort.
 */
object CacheEvictor {

    data class Plan(
        val toEvict: List<String>,
        val sufficient: Boolean,
    )

    fun plan(
        currentFreeBytes: Long,
        neededBytes: Long,
        safetyMargin: Long,
        cached: Collection<MediaCacheIndex.Entry>,
        referencedMediaIds: Set<String>,
    ): Plan {
        val target = neededBytes + safetyMargin
        if (currentFreeBytes >= target) return Plan(emptyList(), sufficient = true)

        val candidates = cached
            .filter { it.mediaId !in referencedMediaIds }
            .sortedWith(
                compareBy(
                    // Unplayed rows first (null lastPlayed → treat as "oldest"):
                    { it.lastPlayedAtEpochSeconds ?: Long.MIN_VALUE },
                    { it.cachedAtEpochSeconds },
                    { it.mediaId },
                ),
            )

        var freed = 0L
        val picks = mutableListOf<String>()
        for (c in candidates) {
            picks += c.mediaId
            freed += c.sizeBytes
            if (currentFreeBytes + freed >= target) break
        }
        return Plan(
            toEvict = picks,
            sufficient = (currentFreeBytes + freed >= target),
        )
    }
}
```

- [ ] **Step 4: Run — expect GREEN (4 passed)**

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/cache/CacheEvictor.kt \
        android-tv/app/src/test/java/com/ouie/signage/cache/CacheEvictorTest.kt
git commit -m "feat(android): CacheEvictor — LRU plan, never evict referenced media"
```

### Task 2.2 — `CacheManager.ensureFreeSpaceFor` + `MediaCacheIndex.listAll`

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/cache/MediaCacheIndex.kt`
- Modify: `android-tv/app/src/main/java/com/ouie/signage/cache/CacheManager.kt`

- [ ] **Step 1: Add `listAll()` to `MediaCacheIndex.kt`**

Open the file and add inside the class (before the companion):

```kotlin
    fun listAll(): List<Entry> {
        helper.readableDatabase.rawQuery(
            "SELECT media_id, ext, checksum, size_bytes, cached_at, last_played_at FROM $TABLE",
            null,
        ).use { c ->
            val out = mutableListOf<Entry>()
            while (c.moveToNext()) {
                out += Entry(
                    mediaId = c.getString(0),
                    ext = c.getString(1),
                    checksum = c.getString(2),
                    sizeBytes = c.getLong(3),
                    cachedAtEpochSeconds = c.getLong(4),
                    lastPlayedAtEpochSeconds = if (c.isNull(5)) null else c.getLong(5),
                )
            }
            return out
        }
    }
```

- [ ] **Step 2: Extend `CacheManager.kt`**

Replace the class body with the below (the additions are `evictor` injection + `ensureFreeSpaceFor` + evictor-driven removal):

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/cache/CacheManager.kt
package com.ouie.signage.cache

import android.os.StatFs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File

class CacheManager(
    val layout: CacheLayout,
    private val index: MediaCacheIndex,
) {

    private val _cached = MutableStateFlow<Set<String>>(emptySet())
    val cached: StateFlow<Set<String>> = _cached.asStateFlow()

    fun rehydrate(allKnownMediaIds: Iterable<String>) {
        val present = mutableSetOf<String>()
        for (id in allKnownMediaIds) {
            val row = index.find(id) ?: continue
            val file = layout.mediaFile(id, row.ext)
            if (file.exists() && file.length() == row.sizeBytes) present += id
            else index.delete(id)
        }
        _cached.value = present
    }

    fun markCached(entry: MediaCacheIndex.Entry) {
        index.upsert(entry)
        _cached.value = _cached.value + entry.mediaId
    }

    fun markMissing(mediaId: String) {
        index.delete(mediaId)
        _cached.value = _cached.value - mediaId
    }

    fun touchPlayed(mediaId: String, epochSeconds: Long) {
        index.markPlayed(mediaId, epochSeconds)
    }

    fun fileFor(mediaId: String): File? {
        val row = index.find(mediaId) ?: return null
        return layout.mediaFile(mediaId, row.ext)
    }

    fun isFullyCached(mediaIds: Collection<String>): Boolean {
        if (mediaIds.isEmpty()) return true
        return _cached.value.containsCol(mediaIds)
    }

    /**
     * Try to free up enough bytes for an impending download. Returns `true` when
     * there's enough room after any needed evictions. Caller (MediaDownloader)
     * can skip the download on `false` and let the playback loop keep the old
     * cached playlist playing.
     */
    fun ensureFreeSpaceFor(
        neededBytes: Long,
        safetyMarginBytes: Long = 32L * 1024 * 1024,
        referencedMediaIds: Set<String>,
    ): Boolean {
        val stats = try { StatFs(layout.root.absolutePath) } catch (_: Throwable) { null }
        val free = stats?.let { it.availableBlocksLong * it.blockSizeLong } ?: Long.MAX_VALUE
        val plan = CacheEvictor.plan(
            currentFreeBytes = free,
            neededBytes = neededBytes,
            safetyMargin = safetyMarginBytes,
            cached = index.listAll(),
            referencedMediaIds = referencedMediaIds,
        )
        for (mediaId in plan.toEvict) {
            val row = index.find(mediaId) ?: continue
            val file = layout.mediaFile(mediaId, row.ext)
            file.delete()
            markMissing(mediaId)
        }
        return plan.sufficient
    }

    private fun <T> Set<T>.containsCol(items: Collection<T>): Boolean = items.all { it in this }
}
```

- [ ] **Step 3: Build verification**

```bash
cd android-tv && ./gradlew :app:assembleDebug 2>&1 | tail -5
```

Expected: BUILD FAILED (FcmTokenSource + PreloadStatusSource + PreloadStatus still missing from Task 1.2 changes). That's OK; commit and move forward.

If the build fails for OTHER reasons (typo in CacheManager etc.), fix before committing.

- [ ] **Step 4: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/cache/CacheManager.kt \
        android-tv/app/src/main/java/com/ouie/signage/cache/MediaCacheIndex.kt
git commit -m "feat(android): CacheManager.ensureFreeSpaceFor + MediaCacheIndex.listAll"
```

### Task 2.3 — Hook evictor into `MediaDownloader`

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/sync/MediaDownloader.kt`
- Modify: `android-tv/app/src/main/java/com/ouie/signage/sync/MediaSyncWorker.kt`

- [ ] **Step 1: Modify `MediaDownloader.kt` to accept an eviction callback**

Update the class signature + first-line behavior:

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/sync/MediaDownloader.kt
package com.ouie.signage.sync

import com.ouie.signage.cache.CacheLayout
import com.ouie.signage.cache.Checksum
import com.ouie.signage.config.MediaDto
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File

class MediaDownloader(
    private val httpClient: OkHttpClient,
    val layout: CacheLayout,
    /**
     * Pre-download hook that gets a chance to free enough disk space. Returns
     * `true` if the caller can safely proceed, `false` to skip the download.
     */
    private val ensureSpace: (bytes: Long) -> Boolean = { true },
) {

    sealed interface Result {
        data object Success : Result
        data object InsufficientSpace : Result
        data class ChecksumMismatch(val expected: String, val actual: String) : Result
        data class NetworkError(val code: Int?, val cause: Throwable?) : Result
    }

    suspend fun download(media: MediaDto, expectedExt: String): Result = withContext(Dispatchers.IO) {
        if (!ensureSpace(media.size_bytes)) return@withContext Result.InsufficientSpace

        layout.mediaDir().mkdirs()
        val temp = layout.tempFile(media.id, expectedExt)
        val dest = layout.mediaFile(media.id, expectedExt)

        if (temp.exists()) temp.delete()

        val response = try {
            httpClient.newCall(Request.Builder().url(media.url).build()).execute()
        } catch (e: CancellationException) {
            throw e
        } catch (t: Throwable) {
            return@withContext Result.NetworkError(code = null, cause = t)
        }

        response.use { resp ->
            if (!resp.isSuccessful) return@withContext Result.NetworkError(resp.code, null)
            val body = resp.body ?: return@withContext Result.NetworkError(resp.code, null)
            try {
                body.byteStream().use { input ->
                    temp.outputStream().use { output -> input.copyTo(output, bufferSize = 64 * 1024) }
                }
            } catch (e: CancellationException) {
                temp.delete()
                throw e
            } catch (t: Throwable) {
                temp.delete()
                return@withContext Result.NetworkError(code = null, cause = t)
            }
        }

        val actualHash = Checksum.sha256OfFile(temp)
        if (actualHash != media.checksum) {
            temp.delete()
            return@withContext Result.ChecksumMismatch(expected = media.checksum, actual = actualHash)
        }

        if (dest.exists()) dest.delete()
        if (!temp.renameTo(dest)) {
            temp.copyTo(dest, overwrite = true)
            temp.delete()
        }
        Result.Success
    }
}
```

- [ ] **Step 2: Update `MediaSyncWorker.kt` to handle the new result + pass eviction set**

Open `MediaSyncWorker.kt`. Modify the `syncAllMissing` + `handleResult`:

```kotlin
    private suspend fun syncAllMissing(cfg: ConfigDto) {
        val referenced = cfg.playlists.flatMap { pl -> pl.items.map { it.media_id } }.toSet()
        val cachedNow = cache.cached.value
        val missing = cfg.media.filter { it.id in referenced && it.id !in cachedNow }

        for (media in missing) {
            if (!kotlinx.coroutines.currentCoroutineContext().isActive) return
            val ext = com.ouie.signage.cache.CacheLayout.extensionFromR2Path(media.url)
            val result = downloader.download(media, expectedExt = ext)
            handleResult(media, ext, result)
        }
    }

    private fun handleResult(media: MediaDto, ext: String, r: MediaDownloader.Result) {
        when (r) {
            MediaDownloader.Result.Success -> {
                cache.markCached(
                    MediaCacheIndex.Entry(
                        mediaId = media.id,
                        ext = ext,
                        checksum = media.checksum,
                        sizeBytes = media.size_bytes,
                        cachedAtEpochSeconds = java.time.Instant.now().epochSecond,
                        lastPlayedAtEpochSeconds = null,
                    ),
                )
                reporter.cached(media.id)
            }
            MediaDownloader.Result.InsufficientSpace -> {
                reporter.failed(media.id, "cache full; eviction could not make room")
            }
            is MediaDownloader.Result.ChecksumMismatch -> {
                reporter.failed(
                    media.id,
                    "checksum mismatch: expected=${r.expected.take(12)}… got=${r.actual.take(12)}…",
                )
            }
            is MediaDownloader.Result.NetworkError -> {
                reporter.failed(
                    media.id,
                    "network: code=${r.code ?: "?"} cause=${r.cause?.javaClass?.simpleName ?: "-"}",
                )
            }
        }
    }
```

- [ ] **Step 3: Update the test to cover `InsufficientSpace`**

Open `android-tv/app/src/test/java/com/ouie/signage/sync/MediaDownloaderTest.kt` and add a fourth test at the end of the class:

```kotlin
    @Test
    fun `ensureSpace returning false short-circuits to InsufficientSpace`() = runBlocking {
        val dl = MediaDownloader(OkHttpClient(), layout(), ensureSpace = { false })
        val result = dl.download(
            MediaDto(
                id = "m1", kind = "video", size_bytes = 11,
                checksum = "0".repeat(64),
                url = "http://unused.example/ignored.mp4",
            ),
            expectedExt = "mp4",
        )
        assertEquals(MediaDownloader.Result.InsufficientSpace, result)
        // No HTTP request was made (server queue is untouched).
        assertEquals(0, server.requestCount)
    }
```

- [ ] **Step 4: Run — expect GREEN (4 tests: happy + mismatch + 5xx + short-circuit)**

```bash
cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.sync.MediaDownloaderTest"
```

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/sync/MediaDownloader.kt \
        android-tv/app/src/main/java/com/ouie/signage/sync/MediaSyncWorker.kt \
        android-tv/app/src/test/java/com/ouie/signage/sync/MediaDownloaderTest.kt
git commit -m "feat(android): MediaDownloader.ensureSpace hook + InsufficientSpace result"
```

---

# Phase 3 — Preload-via-USB

Goal: scan `<cache_root>/../preload/` on startup + at each sync-window boundary, checksum-match files against the current config's media list, atomic-move matches into the cache. Emit a preload summary in the heartbeat payload (spec §4 JSONB shape).

### Task 3.1 — `PreloadStatus.kt` + `PreloadIndex.kt`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/preload/PreloadStatus.kt`
- Create: `android-tv/app/src/main/java/com/ouie/signage/preload/PreloadIndex.kt`

- [ ] **Step 1: Write `PreloadStatus.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/preload/PreloadStatus.kt
package com.ouie.signage.preload

import kotlinx.serialization.Serializable

/**
 * Matches spec §4 `cache_storage_info.preload` JSONB shape exactly. Emitted via
 * the heartbeat payload so the dashboard can render matched / unmatched counts.
 */
@Serializable
data class PreloadStatus(
    val path: String,
    val present: Boolean,
    val file_count: Int,
    val matched_count: Int,
    val unmatched: List<UnmatchedItem> = emptyList(),
)

@Serializable
data class UnmatchedItem(
    val filename: String,
    val size_bytes: Long,
    val sha256: String,
    val seen_at: String,
)

/**
 * Called by HeartbeatScheduler each tick to embed the last scan result.
 */
fun interface PreloadStatusSource {
    fun current(): PreloadStatus?
}
```

- [ ] **Step 2: Write `PreloadIndex.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/preload/PreloadIndex.kt
package com.ouie.signage.preload

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.io.File

/**
 * Caches (path, size, mtime, sha256) tuples so re-scans skip unchanged files.
 * Hashing a 2 GB MP4 takes 10–30 s on mid-tier TV SoCs (spec §6.6); one-shot
 * per file via this index.
 *
 * Lives at `<cache_root>/../preload_index.db` — deliberately a sibling of
 * media.db rather than inside the cache folder, since USB may vanish.
 */
class PreloadIndex(context: Context, dbFile: File) {

    private val helper = object : SQLiteOpenHelper(
        context.applicationContext,
        dbFile.absolutePath,
        null,
        DB_VERSION,
    ) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL("""
                CREATE TABLE $TABLE (
                    path TEXT PRIMARY KEY,
                    size_bytes INTEGER NOT NULL,
                    mtime_ms INTEGER NOT NULL,
                    sha256 TEXT NOT NULL,
                    seen_at INTEGER NOT NULL
                )
            """.trimIndent())
        }
        override fun onUpgrade(db: SQLiteDatabase, oldV: Int, newV: Int) {
            db.execSQL("DROP TABLE IF EXISTS $TABLE")
            onCreate(db)
        }
    }

    data class Entry(
        val path: String,
        val sizeBytes: Long,
        val mtimeMs: Long,
        val sha256: String,
        val seenAtEpochSeconds: Long,
    )

    fun find(path: String): Entry? {
        helper.readableDatabase.rawQuery(
            "SELECT size_bytes, mtime_ms, sha256, seen_at FROM $TABLE WHERE path = ?",
            arrayOf(path),
        ).use { c ->
            if (!c.moveToFirst()) return null
            return Entry(
                path = path,
                sizeBytes = c.getLong(0),
                mtimeMs = c.getLong(1),
                sha256 = c.getString(2),
                seenAtEpochSeconds = c.getLong(3),
            )
        }
    }

    fun upsert(e: Entry) {
        helper.writableDatabase.insertWithOnConflict(
            TABLE, null,
            ContentValues().apply {
                put("path", e.path)
                put("size_bytes", e.sizeBytes)
                put("mtime_ms", e.mtimeMs)
                put("sha256", e.sha256)
                put("seen_at", e.seenAtEpochSeconds)
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    fun delete(path: String) {
        helper.writableDatabase.delete(TABLE, "path = ?", arrayOf(path))
    }

    private companion object {
        const val DB_VERSION = 1
        const val TABLE = "preload_index"
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/preload/PreloadStatus.kt \
        android-tv/app/src/main/java/com/ouie/signage/preload/PreloadIndex.kt
git commit -m "feat(android): PreloadStatus + PreloadIndex — SQLite (path, size, mtime, sha256) cache"
```

### Task 3.2 — `PreloadScanner.kt` (matching logic isolated for TDD)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/preload/PreloadScanner.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/preload/PreloadScannerMatchTest.kt`

Strategy: we TDD the pure decision logic (given a file's hash + size and the config + cached set, what's a match or unmatched?). The file-I/O part (walk preload dir, atomic-move) is straightforward and covered by emulator smoke.

- [ ] **Step 1: Write the failing test**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/preload/PreloadScannerMatchTest.kt
package com.ouie.signage.preload

import com.ouie.signage.config.ConfigDto
import com.ouie.signage.config.DeviceDto
import com.ouie.signage.config.MediaDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PreloadScannerMatchTest {

    private fun cfg(vararg m: MediaDto): ConfigDto = ConfigDto(
        version = "v", device = DeviceDto("d", "s", null, "UTC"), media = m.toList(),
    )

    @Test
    fun `hash matches referenced media not yet cached — returns media id`() {
        val cfg = cfg(MediaDto("mA", "video", 100, checksum = "aa", url = ""))
        val id = PreloadScanner.matchHash(
            sha256 = "aa",
            config = cfg,
            cachedMediaIds = emptySet(),
        )
        assertEquals("mA", id)
    }

    @Test
    fun `hash matches already-cached media — returns null (no re-preload)`() {
        val cfg = cfg(MediaDto("mA", "video", 100, checksum = "aa", url = ""))
        val id = PreloadScanner.matchHash(
            sha256 = "aa",
            config = cfg,
            cachedMediaIds = setOf("mA"),
        )
        assertNull(id)
    }

    @Test
    fun `unknown hash returns null`() {
        val cfg = cfg(MediaDto("mA", "video", 100, checksum = "aa", url = ""))
        assertNull(
            PreloadScanner.matchHash(
                sha256 = "cc",
                config = cfg,
                cachedMediaIds = emptySet(),
            ),
        )
    }

    @Test
    fun `null config treats every hash as unmatched`() {
        assertNull(PreloadScanner.matchHash("aa", null, emptySet()))
    }
}
```

- [ ] **Step 2: Run — expect RED**

- [ ] **Step 3: Implement `PreloadScanner.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/preload/PreloadScanner.kt
package com.ouie.signage.preload

import com.ouie.signage.cache.CacheLayout
import com.ouie.signage.cache.CacheManager
import com.ouie.signage.cache.Checksum
import com.ouie.signage.cache.MediaCacheIndex
import com.ouie.signage.config.ConfigDto
import com.ouie.signage.errorbus.ErrorBus
import com.ouie.signage.sync.CacheStatusReporter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.io.File
import java.time.Instant

/**
 * Walks the preload directory, hashes new/changed files (skip via PreloadIndex),
 * and atomic-moves checksum-matched entries into the cache. Emits a fresh
 * PreloadStatus on every completed scan.
 *
 * Scan runs:
 *   - Once at coordinator start.
 *   - On each config-change (collected via configRepo.current).
 *   - Never blocks the main thread — Dispatchers.IO throughout.
 */
class PreloadScanner(
    private val preloadDir: File,
    private val cache: CacheManager,
    private val index: PreloadIndex,
    private val cacheIndex: MediaCacheIndex,
    private val reporter: CacheStatusReporter,
    private val errorBus: ErrorBus,
) : PreloadStatusSource {

    private val _status = MutableStateFlow<PreloadStatus?>(null)
    val status: StateFlow<PreloadStatus?> = _status.asStateFlow()

    override fun current(): PreloadStatus? = _status.value

    suspend fun scanOnce(config: ConfigDto?): PreloadStatus = withContext(Dispatchers.IO) {
        if (!preloadDir.exists() || !preloadDir.isDirectory) {
            val s = PreloadStatus(
                path = preloadDir.absolutePath,
                present = false,
                file_count = 0,
                matched_count = 0,
            )
            _status.value = s
            return@withContext s
        }

        val files = preloadDir.listFiles { f -> f.isFile }?.toList() ?: emptyList()
        var matched = 0
        val unmatched = mutableListOf<UnmatchedItem>()

        for (file in files) {
            kotlinx.coroutines.currentCoroutineContext().ensureActive()

            val cached = index.find(file.absolutePath)
            val (sha, reused) = if (cached != null && cached.sizeBytes == file.length() && cached.mtimeMs == file.lastModified()) {
                cached.sha256 to true
            } else {
                val fresh = try { Checksum.sha256OfFile(file) } catch (e: CancellationException) { throw e } catch (t: Throwable) {
                    errorBus.report("preload_hash_failed", null, "${file.name}: ${t.message}")
                    continue
                }
                index.upsert(
                    PreloadIndex.Entry(
                        path = file.absolutePath,
                        sizeBytes = file.length(),
                        mtimeMs = file.lastModified(),
                        sha256 = fresh,
                        seenAtEpochSeconds = Instant.now().epochSecond,
                    ),
                )
                fresh to false
            }

            val matchedMediaId = matchHash(sha, config, cache.cached.value)
            if (matchedMediaId != null) {
                importMatched(file, sha, matchedMediaId, config!!)
                matched += 1
            } else {
                unmatched += UnmatchedItem(
                    filename = file.name,
                    size_bytes = file.length(),
                    sha256 = sha,
                    seen_at = Instant.ofEpochSecond(
                        if (reused) cached!!.seenAtEpochSeconds else Instant.now().epochSecond,
                    ).toString(),
                )
            }
        }

        val status = PreloadStatus(
            path = preloadDir.absolutePath,
            present = true,
            file_count = files.size,
            matched_count = matched,
            unmatched = unmatched,
        )
        _status.value = status
        status
    }

    private fun importMatched(file: File, sha: String, mediaId: String, config: ConfigDto) {
        val media = config.media.firstOrNull { it.id == mediaId } ?: return
        val ext = CacheLayout.extensionFromR2Path(media.url)
        val dest = cache.layout.mediaFile(mediaId, ext)
        val tempDest = cache.layout.tempFile(mediaId, ext)
        cache.layout.mediaDir().mkdirs()

        // COPY from preload (NOT move). Spec §6.6: "Never auto-deletes preload
        // files. ... otherwise files remain (operator-owned space)." Operator
        // expects to find their files still on the USB after unplugging.
        // Double-disk cost is acceptable at v1 scale.
        if (tempDest.exists()) tempDest.delete()
        file.copyTo(tempDest, overwrite = true)
        if (dest.exists()) dest.delete()
        if (!tempDest.renameTo(dest)) {
            // Cross-device fallback — same-folder rename should normally succeed.
            tempDest.copyTo(dest, overwrite = true)
            tempDest.delete()
        }

        cache.markCached(
            MediaCacheIndex.Entry(
                mediaId = mediaId,
                ext = ext,
                checksum = sha,
                sizeBytes = dest.length(),
                cachedAtEpochSeconds = Instant.now().epochSecond,
                lastPlayedAtEpochSeconds = null,
            ),
        )
        reporter.report(
            com.ouie.signage.net.CacheStatusEvent(
                state = "preloaded",
                media_id = mediaId,
                message = "source=${file.name}",
            ),
        )
    }

    companion object {
        /**
         * Pure decision: is this hash a match for something we want?
         * Returns the media_id to import, or null if we already have it cached
         * or the hash isn't in the config at all.
         */
        fun matchHash(sha256: String, config: ConfigDto?, cachedMediaIds: Set<String>): String? {
            if (config == null) return null
            val hit = config.media.firstOrNull { it.checksum == sha256 } ?: return null
            return if (hit.id in cachedMediaIds) null else hit.id
        }
    }
}
```

- [ ] **Step 4: Run — expect GREEN (4 passed)**

```bash
cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.preload.PreloadScannerMatchTest"
```

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/preload/PreloadScanner.kt \
        android-tv/app/src/test/java/com/ouie/signage/preload/PreloadScannerMatchTest.kt
git commit -m "feat(android): PreloadScanner — hash-match + atomic-move + heartbeat status"
```

---

# Phase 4 — FCM ("Sync Now" listener + token registration)

Goal: accept FCM data messages with `action: "sync"` and kick the coordinator's `triggerSyncNow()`. Emit the FCM token through the heartbeat payload so the server can reach us.

### Task 4.1 — `FcmTokenSource.kt` + `SyncNowBroadcast.kt`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/fcm/FcmTokenSource.kt`
- Create: `android-tv/app/src/main/java/com/ouie/signage/fcm/SyncNowBroadcast.kt`

- [ ] **Step 1: Write `FcmTokenSource.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/fcm/FcmTokenSource.kt
package com.ouie.signage.fcm

import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Lazily obtains the FCM token and caches it in-memory. `current()` returns the
 * most recent value or null if we haven't fetched yet. The first heartbeat
 * after boot may carry null (unless cached) — subsequent heartbeats will have
 * the token.
 *
 * Also handles token-refresh callbacks from FCM: MessagingService.onNewToken
 * calls `update(newToken)` so the next heartbeat ships the fresh value.
 */
class FcmTokenSource(private val scope: CoroutineScope) {

    @Volatile private var cached: String? = null

    fun current(): String? = cached

    fun update(token: String) { cached = token }

    /**
     * Fire-and-forget bootstrap from the coordinator. Resolves a token, stores
     * it. Failure is silently ignored — FCM will retry on its own.
     */
    fun prime() {
        scope.launch(Dispatchers.IO) {
            try {
                val token = awaitToken()
                cached = token
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                // Google Play Services missing / network / etc. Heartbeat carries null.
            }
        }
    }

    private suspend fun awaitToken(): String = suspendCancellableCoroutine { cont ->
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { cont.resume(it) }
            .addOnFailureListener { cont.resumeWithException(it) }
    }
}
```

- [ ] **Step 2: Write `SyncNowBroadcast.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/fcm/SyncNowBroadcast.kt
package com.ouie.signage.fcm

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Single app-wide pub/sub for "sync immediately". `SignageMessagingService`
 * emits via `fire()`; `RunningCoordinator` collects via `events` and runs the
 * sync cycle on receipt. Koin single, so the service side and coordinator side
 * share the same instance.
 *
 * extraBufferCapacity=1 + onBufferOverflow=DROP_OLDEST — if 100 messages come
 * in while we're offline, we don't want to sync 100 times on reconnect; one
 * coalesced sync is enough.
 */
class SyncNowBroadcast {
    private val _events = MutableSharedFlow<Unit>(
        replay = 0,
        extraBufferCapacity = 1,
        onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST,
    )
    val events: SharedFlow<Unit> = _events.asSharedFlow()

    fun fire() { _events.tryEmit(Unit) }
}
```

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/fcm/FcmTokenSource.kt \
        android-tv/app/src/main/java/com/ouie/signage/fcm/SyncNowBroadcast.kt
git commit -m "feat(android): FcmTokenSource — lazy token cache + update; SyncNowBroadcast — DROP_OLDEST sync signal"
```

### Task 4.2 — `SignageMessagingService.kt` + manifest registration

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/fcm/SignageMessagingService.kt`
- Modify: `android-tv/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Write `SignageMessagingService.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/fcm/SignageMessagingService.kt
package com.ouie.signage.fcm

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.koin.java.KoinJavaComponent.inject

/**
 * Receives FCM data messages. The only action we care about in v1 is
 * `action = "sync"` (spec §6.4); everything else is logged and ignored.
 *
 * Service is instantiated by Android (no constructor injection), so we pull
 * Koin singles via `inject`. Plan 3c's coordinator is NOT started from here —
 * the foreground service owns coordinator lifetime. We just poke the sync
 * broadcast; the coordinator will pick it up if it's running.
 */
class SignageMessagingService : FirebaseMessagingService() {

    private val broadcast: SyncNowBroadcast by inject(SyncNowBroadcast::class.java)
    private val tokenSource: FcmTokenSource by inject(FcmTokenSource::class.java)

    override fun onMessageReceived(message: RemoteMessage) {
        val action = message.data["action"]
        if (action == "sync") broadcast.fire()
    }

    override fun onNewToken(token: String) {
        tokenSource.update(token)
    }
}
```

- [ ] **Step 2: Register the service in `AndroidManifest.xml`**

Inside the `<application>` block, after the `<activity>` element, add:

```xml
        <service
            android:name=".fcm.SignageMessagingService"
            android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>
```

- [ ] **Step 3: Build verification**

```bash
cd android-tv && ./gradlew :app:assembleDebug 2>&1 | tail -5
```

Expected: still fails because `HeartbeatScheduler` references `PreloadStatusSource` which now exists, but `SignageService` (Task 5.1) isn't yet. That's OK for now — the FCM message service compiles in isolation.

If the error is specifically about `PreloadStatusSource` or `FcmTokenSource` being unresolved, that's expected until this phase completes and Phase 5 lands.

- [ ] **Step 4: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/fcm/SignageMessagingService.kt \
        android-tv/app/src/main/AndroidManifest.xml
git commit -m "feat(android): SignageMessagingService — FCM 'sync' → SyncNowBroadcast + onNewToken"
```

### Task 4.3 — Extend `devices-heartbeat` server side to write `fcm_token`

**Files:**
- Modify: `supabase/functions/devices-heartbeat/index.ts`

- [ ] **Step 1: Extend the Edge Function**

Open the file. After the existing conditional writes (the `if (typeof body.clock_skew_seconds_from_server === "number")` line), add:

```typescript
  if (typeof body.fcm_token === "string" && body.fcm_token.length > 0) {
    update.fcm_token = body.fcm_token;
  }
  // errors_since_last_heartbeat: accepted but not persisted in v1; the device
  // emits it per spec §8, server-side storage is a follow-up plan. Log count
  // so edge function logs give visibility.
  if (Array.isArray(body.errors_since_last_heartbeat) && body.errors_since_last_heartbeat.length > 0) {
    console.log(`device=${claims.sub} errors=${body.errors_since_last_heartbeat.length}`);
  }
```

- [ ] **Step 2: Deploy**

```bash
pnpm dlx dotenv-cli -e .env.production -- supabase functions deploy devices-heartbeat
```

Expected: `Deployed Functions on project swhwrlpoqjijxcvywzto: devices-heartbeat`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/devices-heartbeat/index.ts
git commit -m "feat(fn): devices-heartbeat — write fcm_token; log errors_since_last_heartbeat count"
```

---

# Phase 5 — Foreground service + boot receiver

Goal: pull `RunningCoordinator` out of `MainActivity` lifecycle into a `SignageService`. Add `BootReceiver` for auto-launch.

### Task 5.1 — `ServiceNotification.kt` + `SignageService.kt`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/service/ServiceNotification.kt`
- Create: `android-tv/app/src/main/java/com/ouie/signage/service/SignageService.kt`

- [ ] **Step 1: Write `ServiceNotification.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/service/ServiceNotification.kt
package com.ouie.signage.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * Persistent notification for the foreground service. TVs show this in the
 * system's active-app chrome (MIUI, Google TV) — it's intentionally dull:
 * small icon, fixed text, no tap action. Customers never see it; operators
 * do while managing the TV.
 */
object ServiceNotification {

    private const val CHANNEL_ID = "signage_runner"
    const val NOTIFICATION_ID = 1

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = context.getSystemService(NotificationManager::class.java)
            val existing = mgr.getNotificationChannel(CHANNEL_ID)
            if (existing == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "Signage runner",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "Keeps the player running in the background"
                    setShowBadge(false)
                }
                mgr.createNotificationChannel(channel)
            }
        }
    }

    fun build(context: Context): Notification {
        ensureChannel(context)
        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Signage Player")
            .setContentText("Running")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
}
```

- [ ] **Step 2: Write `SignageService.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/service/SignageService.kt
package com.ouie.signage.service

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.ouie.signage.coordinator.RunningCoordinator
import org.koin.android.ext.android.inject

/**
 * Foreground service host. Owns RunningCoordinator's lifetime so playback
 * survives Activity destruction, configuration changes, and (mostly) OS kills.
 *
 * START_STICKY: if the OS does kill us under memory pressure, it will attempt
 * a restart with a null intent — onStartCommand handles that by re-invoking
 * coordinator.start() (idempotent).
 *
 * Called from MainActivity on AppState.Running; from BootReceiver on device boot.
 */
class SignageService : Service() {

    private val coordinator: RunningCoordinator by inject()

    override fun onCreate() {
        super.onCreate()
        val notification = ServiceNotification.build(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                ServiceNotification.NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(ServiceNotification.NOTIFICATION_ID, notification)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        coordinator.start()
        return START_STICKY
    }

    override fun onDestroy() {
        coordinator.stop()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
```

- [ ] **Step 3: Register service + permissions in `AndroidManifest.xml`**

Add these `uses-permission` entries near the top (next to the existing `INTERNET` + `ACCESS_NETWORK_STATE`):

```xml
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC"
        tools:targetApi="34" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"
        tools:targetApi="33" />
```

Then inside the `<application>` block, add the service element:

```xml
        <service
            android:name=".service.SignageService"
            android:exported="false"
            android:foregroundServiceType="dataSync" />
```

- [ ] **Step 4: Build verification**

```bash
cd android-tv && ./gradlew :app:assembleDebug 2>&1 | tail -5
```

Expected: BUILD FAILS — coordinator's `triggerSyncNow()` doesn't exist yet (Task 5.3 adds it). Build will pass after Task 5.3.

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/service/ \
        android-tv/app/src/main/AndroidManifest.xml
git commit -m "feat(android): SignageService foreground + manifest permissions for boot + FGS"
```

### Task 5.2 — `BootReceiver.kt` + manifest registration

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/boot/BootReceiver.kt`
- Modify: `android-tv/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Write `BootReceiver.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/boot/BootReceiver.kt
package com.ouie.signage.boot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.ouie.signage.MainActivity
import com.ouie.signage.service.SignageService

/**
 * Auto-start on device boot (Risk #2 mitigation — spec §6.7). Two actions:
 *   1. BOOT_COMPLETED (stock Android)
 *   2. QUICKBOOT_POWERON (MIUI-specific fast-boot intent)
 *
 * Flow:
 *   a. Start SignageService via ContextCompat.startForegroundService. Service
 *      brings the coordinator up so playback resumes even if the Activity
 *      doesn't launch.
 *   b. Attempt to launch MainActivity with FLAG_ACTIVITY_NEW_TASK. On Android
 *      TV this is generally permitted; on phones at API 29+ it may fail
 *      silently — which is why (a) exists first.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON" -> {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, SignageService::class.java),
                )
                // Best-effort activity launch. If OS refuses (background-activity-start
                // restrictions), the service is still running and the operator
                // can tap LEANBACK_LAUNCHER → Signage Player.
                val activity = Intent(context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try { context.startActivity(activity) } catch (_: Throwable) { }
            }
        }
    }
}
```

- [ ] **Step 2: Register the receiver in `AndroidManifest.xml`**

Inside the `<application>` block, add:

```xml
        <receiver
            android:name=".boot.BootReceiver"
            android:exported="true"
            android:directBootAware="false">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.QUICKBOOT_POWERON" />
            </intent-filter>
        </receiver>
```

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/boot/ \
        android-tv/app/src/main/AndroidManifest.xml
git commit -m "feat(android): BootReceiver — BOOT_COMPLETED + QUICKBOOT_POWERON → service + activity"
```

### Task 5.3 — Extend `RunningCoordinator` with `triggerSyncNow` + integrations

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/coordinator/RunningCoordinator.kt`

The coordinator grows: consumes `SyncNowBroadcast`, `FcmTokenSource`, `ErrorBus`, `PreloadScanner`, and exposes `triggerSyncNow()`.

- [ ] **Step 1: Rewrite `RunningCoordinator.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/coordinator/RunningCoordinator.kt
package com.ouie.signage.coordinator

import android.content.Context
import android.os.StatFs
import android.os.storage.StorageManager
import com.ouie.signage.cache.CacheLayout
import com.ouie.signage.cache.CacheManager
import com.ouie.signage.cache.CacheRootResolver
import com.ouie.signage.cache.MediaCacheIndex
import com.ouie.signage.config.ConfigPoller
import com.ouie.signage.config.ConfigRepository
import com.ouie.signage.config.ConfigStore
import com.ouie.signage.errorbus.ErrorBus
import com.ouie.signage.fcm.FcmTokenSource
import com.ouie.signage.fcm.SyncNowBroadcast
import com.ouie.signage.heartbeat.ClockSkewTracker
import com.ouie.signage.heartbeat.HeartbeatScheduler
import com.ouie.signage.net.CacheStatusApi
import com.ouie.signage.net.ConfigApi
import com.ouie.signage.net.HeartbeatApi
import com.ouie.signage.playback.PlaybackDirector
import com.ouie.signage.preload.PreloadIndex
import com.ouie.signage.preload.PreloadScanner
import com.ouie.signage.sync.CacheStatusReporter
import com.ouie.signage.sync.MediaDownloader
import com.ouie.signage.sync.MediaSyncWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import java.io.File

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
) {

    private var scope: CoroutineScope? = null
    private var configPoller: ConfigPoller? = null
    private var heartbeat: HeartbeatScheduler? = null
    private var sync: MediaSyncWorker? = null
    private var reporter: CacheStatusReporter? = null
    private var preloadScanner: PreloadScanner? = null
    private var configRepoRef: ConfigRepository? = null
    private var cacheRef: CacheManager? = null

    private val _cachePick = MutableStateFlow<CacheRootResolver.Pick?>(null)
    val cachePick: StateFlow<CacheRootResolver.Pick?> = _cachePick.asStateFlow()

    private val _playbackDirector = MutableStateFlow<PlaybackDirector?>(null)
    val playbackDirector: StateFlow<PlaybackDirector?> = _playbackDirector.asStateFlow()

    fun start() {
        if (scope != null) return
        val newScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        scope = newScope

        val pick = pickCacheRoot(context)
        _cachePick.value = pick
        val layout = CacheLayout(pick.root)
        layout.mediaDir().mkdirs()
        val index = MediaCacheIndex(context, layout.indexDbFile())
        val cache = CacheManager(layout, index)
        cacheRef = cache

        val configDir = File(context.filesDir, "signage/config")
        val configStore = ConfigStore(configDir, json)
        val configRepo = ConfigRepository(configApi, configStore)
        configRepoRef = configRepo

        val director = PlaybackDirector(
            config = configRepo.current,
            cachedMediaIds = cache.cached,
            fileFor = { id -> cache.fileFor(id) },
        )
        _playbackDirector.value = director

        val knownIds: List<String> = configRepo.current.value?.media?.map { it.id } ?: emptyList()
        cache.rehydrate(knownIds)

        val downloader = MediaDownloader(
            httpClient = downloaderHttpClient,
            layout = layout,
            ensureSpace = { bytes ->
                val referenced = configRepo.current.value?.playlists
                    ?.flatMap { pl -> pl.items.map { it.media_id } }
                    ?.toSet()
                    ?: emptySet()
                cache.ensureFreeSpaceFor(bytes, referencedMediaIds = referenced)
            },
        )
        val report = CacheStatusReporter(newScope, cacheStatusApi)
        reporter = report
        report.start()

        val syncer = MediaSyncWorker(
            scope = newScope,
            configRepo = configRepo,
            cache = cache,
            downloader = downloader,
            reporter = report,
            index = index,
        )
        sync = syncer
        syncer.start()

        // Preload scanner — runs at start + on each config change.
        val preloadDir = File(pick.root.parentFile ?: pick.root, "preload")
        val preloadIndex = PreloadIndex(context, File(pick.root.parentFile ?: pick.root, "preload_index.db"))
        val scanner = PreloadScanner(
            preloadDir = preloadDir,
            cache = cache,
            index = preloadIndex,
            cacheIndex = index,
            reporter = report,
            errorBus = errorBus,
        )
        preloadScanner = scanner
        configRepo.current.onEach { cfg ->
            scanner.scanOnce(cfg)
        }.launchIn(newScope)

        val poller = ConfigPoller(newScope, configRepo)
        configPoller = poller
        poller.start()

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
        )
        heartbeat = beat
        beat.start()

        // FCM-driven sync-now: every broadcast triggers an immediate config refetch.
        syncNow.events.onEach {
            triggerSyncNow()
        }.launchIn(newScope)

        fcmTokenSource.prime()
        director.startTicker(newScope)
    }

    /**
     * Immediate-sync path (spec §6.4). Invoked by FCM data message or the
     * playback loop's "desired not cached" branch. Fires a config fetch + sync
     * cycle outside the 60 s poll cadence.
     */
    fun triggerSyncNow() {
        val s = scope ?: return
        val repo = configRepoRef ?: return
        s.launch {
            try {
                repo.fetch()  // MediaSyncWorker collects configRepo.current, auto-reacts
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (t: Throwable) {
                errorBus.report("sync_now_failed", null, t.message)
            }
        }
    }

    fun stop() {
        _playbackDirector.value?.stopTicker()
        _playbackDirector.value = null
        configPoller?.stop(); configPoller = null
        heartbeat?.stop();    heartbeat = null
        sync?.stop();         sync = null
        reporter?.stop();     reporter = null
        preloadScanner = null
        configRepoRef = null
        cacheRef = null
        scope?.cancel()
        scope = null
        _cachePick.value = null
    }

    private fun pickCacheRoot(context: Context): CacheRootResolver.Pick {
        val externalDirs = context.getExternalFilesDirs(null).filterNotNull().filter { it.exists() }
        val primary = externalDirs.drop(1)
        val candidates = primary.map { dir ->
            val stats = try { StatFs(dir.absolutePath) } catch (_: Throwable) { null }
            val free = stats?.let { it.availableBlocksLong * it.blockSizeLong } ?: 0L
            CacheRootResolver.Candidate(dir = File(dir, "cache"), freeBytes = free, isExternal = true)
        }
        val internalDir = File(context.filesDir, "signage/cache")
        internalDir.mkdirs()
        val internalStats = try { StatFs(internalDir.absolutePath) } catch (_: Throwable) { null }
        val internalFree = internalStats?.let { it.availableBlocksLong * it.blockSizeLong } ?: 0L

        val sm = context.getSystemService(Context.STORAGE_SERVICE) as? StorageManager
        val additional: List<CacheRootResolver.Candidate> = try {
            sm?.storageVolumes?.mapNotNull { v ->
                if (v.isPrimary) return@mapNotNull null
                val dir = v.directory ?: return@mapNotNull null
                val stats = try { StatFs(dir.absolutePath) } catch (_: Throwable) { null }
                val free = stats?.let { it.availableBlocksLong * it.blockSizeLong } ?: 0L
                CacheRootResolver.Candidate(dir = File(dir, "signage/cache"), freeBytes = free, isExternal = true)
            } ?: emptyList()
        } catch (_: Throwable) { emptyList() }

        return CacheRootResolver.pick(
            candidates = (candidates + additional).distinctBy { it.dir.absolutePath },
            internalDir = internalDir,
            internalFreeBytes = internalFree,
            minExternalBytes = 4L * 1024 * 1024 * 1024,
        )
    }
}
```

- [ ] **Step 2: Build verification**

```bash
cd android-tv && ./gradlew :app:assembleDebug 2>&1 | tail -5
```

Expected: BUILD FAILS — `AppModule.kt` still passes the old constructor args. Task 5.4 fixes that.

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/coordinator/RunningCoordinator.kt
git commit -m "feat(android): RunningCoordinator — triggerSyncNow + ErrorBus + Preload + FCM wiring"
```

### Task 5.4 — Update `AppModule.kt` + `MainActivity.kt` for service-owned coordinator

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt`
- Modify: `android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt`

- [ ] **Step 1: Replace the AppModule contents**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt
package com.ouie.signage.di

import com.ouie.signage.auth.TokenSource
import com.ouie.signage.auth.TokenStore
import com.ouie.signage.coordinator.RunningCoordinator
import com.ouie.signage.errorbus.ErrorBus
import com.ouie.signage.fcm.FcmTokenSource
import com.ouie.signage.fcm.SyncNowBroadcast
import com.ouie.signage.heartbeat.ClockSkewTracker
import com.ouie.signage.net.ApiClient
import com.ouie.signage.net.AuthInterceptor
import com.ouie.signage.net.CacheStatusApi
import com.ouie.signage.net.ConfigApi
import com.ouie.signage.net.DateHeaderInterceptor
import com.ouie.signage.net.DeviceApi
import com.ouie.signage.net.HeartbeatApi
import com.ouie.signage.net.PairingApi
import com.ouie.signage.net.RefreshAdapter
import com.ouie.signage.net.RetrofitRefreshAdapter
import com.ouie.signage.net.TokenAuthenticator
import com.ouie.signage.pairing.PairingRepository
import com.ouie.signage.pairing.PairingViewModel
import com.ouie.signage.state.AppStateHolder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import org.koin.android.ext.koin.androidContext
import org.koin.core.module.dsl.viewModel
import org.koin.core.qualifier.named
import org.koin.dsl.module

val appModule = module {
    single { AppStateHolder() }
    single<TokenSource> { TokenStore(androidContext()) }
    single { ClockSkewTracker() }
    single { Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false } }

    // App-wide error bus. Consumers report; HeartbeatScheduler drains.
    single { ErrorBus(capacity = 32) }

    // SyncNowBroadcast connects the FCM service and the coordinator.
    single { SyncNowBroadcast() }

    // FCM token cache — lives as long as the app process.
    single { FcmTokenSource(scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)) }

    // Pairing client — no auth, no skew tracking.
    single(qualifier = named("pairing")) { ApiClient.baseHttpClient().build() }
    single { ApiClient.retrofit(get(qualifier = named("pairing"))).create(PairingApi::class.java) }

    // Refresh client — no authenticator, to break the chicken-and-egg inside refresh.
    single(qualifier = named("device_refresh")) { ApiClient.baseHttpClient().build() }
    single { ApiClient.retrofit(get(qualifier = named("device_refresh"))).create(DeviceApi::class.java) }
    single<RefreshAdapter> { RetrofitRefreshAdapter(get()) }

    single(qualifier = named("authed")) {
        ApiClient.baseHttpClient()
            .addInterceptor(AuthInterceptor(get()))
            .addInterceptor(DateHeaderInterceptor(get()))
            .authenticator(TokenAuthenticator(get(), get()))
            .build()
    }
    single { ApiClient.retrofit(get<OkHttpClient>(qualifier = named("authed"))).create(ConfigApi::class.java) }
    single { ApiClient.retrofit(get<OkHttpClient>(qualifier = named("authed"))).create(HeartbeatApi::class.java) }
    single { ApiClient.retrofit(get<OkHttpClient>(qualifier = named("authed"))).create(CacheStatusApi::class.java) }

    single(qualifier = named("downloader")) { ApiClient.baseHttpClient().build() }

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
        )
    }

    single {
        PairingRepository(
            api = get(),
            proposedName = android.os.Build.MODEL ?: "Android TV",
        )
    }
    viewModel { PairingViewModel(repo = get(), tokenStore = get(), appState = get()) }
}
```

- [ ] **Step 2: Replace `MainActivity.kt` so it delegates lifecycle to the service**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt
package com.ouie.signage

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.core.content.ContextCompat
import com.ouie.signage.auth.TokenSource
import com.ouie.signage.coordinator.RunningCoordinator
import com.ouie.signage.error.ErrorScreen
import com.ouie.signage.pairing.PairingScreen
import com.ouie.signage.running.RunningScreen
import com.ouie.signage.service.SignageService
import com.ouie.signage.state.AppState
import com.ouie.signage.state.AppStateHolder
import org.koin.android.ext.android.inject

class MainActivity : ComponentActivity() {

    private val appState: AppStateHolder by inject()
    private val tokenStore: TokenSource by inject()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        tokenStore.loadSync()?.let { appState.toRunning(it.deviceId) }
        setContent { SignageRoot(appState) }
    }
}

@Composable
private fun SignageRoot(appState: AppStateHolder) {
    val state by appState.state.collectAsState()
    val context = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(state) {
        when (state) {
            is AppState.Running -> ContextCompat.startForegroundService(
                context,
                Intent(context, SignageService::class.java),
            )
            else -> context.stopService(Intent(context, SignageService::class.java))
        }
    }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        when (val s = state) {
            AppState.Pairing -> PairingScreen()
            is AppState.Running -> RunningScreen(deviceId = s.deviceId)
            is AppState.Error -> ErrorScreen(
                kind = s.kind,
                onRetry = { appState.recoverToPairing() },
            )
        }
    }
}
```

- [ ] **Step 3: Build verification**

```bash
cd android-tv && ./gradlew :app:assembleDebug 2>&1 | tail -5
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Full unit-test pass**

```bash
cd android-tv && ./gradlew :app:testDebugUnitTest 2>&1 | tail -5
```

Expected: GREEN (Plan 3b's 14 classes + ErrorBusTest + CacheEvictorTest + PreloadScannerMatchTest + MediaDownloaderTest's fourth test = 17 test classes).

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt \
        android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt
git commit -m "feat(android): AppModule + MainActivity — service-owned coordinator lifetime"
```

### Task 5.5 — Bump versionName

**Files:**
- Modify: `android-tv/app/build.gradle.kts`

- [ ] **Step 1: Change the version**

In `defaultConfig { }`, change:

```kotlin
versionName = "0.3.0-3c"
```

- [ ] **Step 2: Commit**

```bash
git add android-tv/app/build.gradle.kts
git commit -m "chore(android): bump versionName to 0.3.0-3c"
```

---

# Phase 6 — Launcher banner + emulator smoke

Goal: verify the Leanback launcher banner is rendered, catch any manifest regressions, and run a full cycle on the emulator.

### Task 6.1 — Upgrade banner drawable + verify launcher visibility

**Files:**
- Modify: `android-tv/app/src/main/res/drawable/banner.xml` (kept simple — TV banner dimension hint)
- Modify: `android-tv/app/src/main/res/values/strings.xml` (ensure `app_name` reads "Signage Player")

- [ ] **Step 1: Inspect current banner**

```bash
cat android-tv/app/src/main/res/drawable/banner.xml
```

Plan 3a's banner is a stub shape. Replace with a sharper stub that's less likely to fail Leanback shelf validation:

```xml
<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item>
        <shape android:shape="rectangle">
            <size android:width="320dp" android:height="180dp" />
            <solid android:color="#0F172A" />
        </shape>
    </item>
    <item>
        <shape android:shape="rectangle">
            <stroke android:width="2dp" android:color="#1E293B" />
        </shape>
    </item>
</layer-list>
```

- [ ] **Step 2: Confirm strings.xml is correct**

```bash
cat android-tv/app/src/main/res/values/strings.xml
```

`app_name` should read `Signage Player` (matches Plan 3a). If not, edit it.

- [ ] **Step 3: Install + verify banner appears on the TV home**

```bash
cd android-tv && ./gradlew :app:installDebug
adb shell am start -n com.ouie.signage.debug/com.ouie.signage.MainActivity
# On the emulator, press Home; verify "Signage Player" appears in the apps row
# with the banner drawable.
adb exec-out screencap -p > /tmp/plan3c-launcher.png
open /tmp/plan3c-launcher.png
```

If the banner shows, you're good. If not, the APK didn't register its `LEANBACK_LAUNCHER` intent-filter — re-check `AndroidManifest.xml` (Plan 3a's manifest already declares it).

- [ ] **Step 4: Commit**

```bash
git add android-tv/app/src/main/res/drawable/banner.xml
git commit -m "chore(android): tighten launcher banner styling"
```

### Task 6.2 — Full emulator smoke (FCM sync-now + heartbeat + preload)

**Files:** none (acceptance)

- [ ] **Step 1: Fresh install + pair**

```bash
adb shell pm clear com.ouie.signage.debug
cd android-tv && ./gradlew :app:installDebug
adb shell am start -n com.ouie.signage.debug/com.ouie.signage.MainActivity
# Read pairing code from emulator screen via screencap, claim via dashboard.
```

- [ ] **Step 2: Verify FCM token landed on server**

```bash
# Wait ~90 s for the first heartbeat post-pair to carry fcm_token.
adb logcat -d -v time | grep -E "fcm_token|devices-heartbeat" | tail -5
```

In logcat you should see the heartbeat body include `"fcm_token":"..."`. On the dashboard, open the device detail page — `device.fcm_token` is now populated (the dashboard doesn't render it yet, but a direct `gh api` check or SQL select would show it).

- [ ] **Step 3: Click "Sync Now" from dashboard, verify latency**

Click the Sync Now button on `/app/screens/<device-id>`. Watch logcat:

```bash
adb logcat -v time | grep --line-buffered -E "devices-config|devices-cache-status|SignageMessaging"
```

Expected: within ≤ 5 s of the click (not waiting the 60 s poll), the device fires a `GET devices-config`. `SignageMessagingService.onMessageReceived` is the trigger.

- [ ] **Step 4: Preload dry run (if you have a config with media)**

Push an already-cached media file into the preload directory via adb:

```bash
# Create the preload dir on the emulator (mirrors the real-TV USB path).
adb shell run-as com.ouie.signage.debug mkdir -p files/signage/preload  # adjust based on cache root — internal on emulator
# Push a local file.
adb push /tmp/plan3b-test-image.jpg /sdcard/plan3c-preload-test.jpg
adb shell run-as com.ouie.signage.debug sh -c 'cp /sdcard/plan3c-preload-test.jpg files/signage/preload/plan3c-preload-test.jpg'
```

Wait for the next config-change tick (60 s or trigger via Sync Now). In logcat you should see `cache-status state=preloaded` posted.

*If this step is cumbersome on emulator, defer to Task 7.1 real-hardware USB test.*

- [ ] **Step 5: Reboot smoke**

```bash
adb reboot
# Wait for boot:
adb wait-for-device shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 1; done; echo booted'
# Check that the app is running in foreground (from BootReceiver → Service):
adb shell dumpsys activity services com.ouie.signage.debug | grep SignageService
```

Expected: `SignageService` appears as a running service. Then open the Leanback launcher via the emulator remote and confirm playback resumes (emulator's screencap is unreliable for video; the logcat showing heartbeat POSTs is good enough).

- [ ] **Step 6: Phase close commit**

```bash
git commit --allow-empty -m "chore(android): Phase 6 emulator acceptance — FCM + preload + reboot verified"
```

---

# Phase 7 — Real-hardware acceptance

Goal: first time the APK runs on an actual F&B TV. Highest-value phase for real-world validation.

### Task 7.1 — Real-hardware smoke

**Files:** none

- [ ] **Step 1: Connect via LAN ADB**

Per prerequisite #4:

```bash
adb connect <tv-ip>:5555
adb devices
```

- [ ] **Step 2: Factory-style clean state**

```bash
adb -s <tv-ip>:5555 shell pm clear com.ouie.signage.debug || true
adb -s <tv-ip>:5555 uninstall com.ouie.signage.debug || true
```

- [ ] **Step 3: Install + launch**

```bash
cd android-tv && ./gradlew :app:installDebug
adb -s <tv-ip>:5555 shell am start -n com.ouie.signage.debug/com.ouie.signage.MainActivity
```

- [ ] **Step 4: Pair from dashboard → verify playback**

- Read pairing code from the TV.
- Claim via `/app/screens/add` on the dashboard.
- Assign the existing playlist (or create a new one) as the fallback.
- Watch the TV — within ≤ 60 s, playback begins. Verify: (a) image renders correctly with no aspect issues, (b) video plays with no decoder glitch, (c) cycle loops cleanly.

Take a photo of the TV screen for the PR record.

- [ ] **Step 5: Preload-via-USB test**

- Insert a FAT32 / exFAT USB stick into the TV.
- Copy the already-uploaded media files from your Mac into `<usb_mount>/Android/data/com.ouie.signage.debug/files/preload/`.
- Trigger a config refresh via dashboard Sync Now.
- Watch logcat for `cache-status state=preloaded`. Dashboard's device detail page: `cache_storage_info.preload.matched_count` should be non-zero.

- [ ] **Step 6: Reboot test**

Unplug the TV power, wait 5 s, plug back in. Within ≤ 30 s of boot, playback should auto-resume (via `BootReceiver`). If it doesn't and the app needs to be launched manually from the Leanback launcher, note that in the operator runbook (spec §6.7 fallback).

- [ ] **Step 7: FCM latency**

Click Sync Now from the dashboard with the TV connected. Stopwatch-measure: from click → playback-config-update on the TV. Should be ≤ 5 s.

- [ ] **Step 8: Factory-clean the TV afterward**

```bash
adb -s <tv-ip>:5555 shell pm clear com.ouie.signage.debug
# Dashboard: delete the test device from /app/screens (or keep it if this will be one of the prod TVs)
```

- [ ] **Step 9: Phase close commit**

```bash
git commit --allow-empty -m "chore(android): Phase 7 real-hardware acceptance — <brand/model> full cycle verified"
```

*If no real TV is available today, skip this phase and flag it in the PR body as "real-hardware acceptance deferred." The plan is still technically complete, but v1 isn't shippable without it.*

---

# Phase 8 — Docs + CLAUDE.md

### Task 8.1 — Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Flip the status line**

Change the top-of-file Status line to reflect Plan 3c complete:

```
**Status (as of 2026-04-24):** **Plans 1 + 2 + 2.1 + 2.2 + 3a + 3b + 3c complete. Dashboard live at https://signage-ouie.vercel.app; Android TV APK pairs, heartbeats, syncs config, downloads media, plays via ExoPlayer/Compose, receives FCM sync-now pushes, auto-launches after reboot, LRU-evicts stale cache, imports preloaded USB media, and ships an error bus in the heartbeat payload. First real-hardware deployment verified on <brand/model>.**
```

- [ ] **Step 2: Add "Plan 3c (done)" to Key file pointers**

```
- Plan 3c (done): `docs/superpowers/plans/2026-04-23-plan-3c-android-hardening.md`
```

- [ ] **Step 3: Append 3c-specific conventions to "Conventions decided during this project"**

```
- **Foreground service owns coordinator lifetime (Plan 3c).** `SignageService` is started by `MainActivity` on `AppState.Running` (and by `BootReceiver` on device boot). The service's `onCreate` calls `startForeground`; `onStartCommand` calls `coordinator.start()` (idempotent) and returns `START_STICKY` so the OS re-launches us after memory-pressure kills. Stopping the service via `stopService` cancels the coordinator's scope.
- **FCM data messages route through `SyncNowBroadcast` (Plan 3c).** `SignageMessagingService.onMessageReceived` for `action: "sync"` calls `SyncNowBroadcast.fire()`. The coordinator's start() subscribes and calls `triggerSyncNow()` on each emission. DROP_OLDEST buffer means bursty pushes collapse to one sync.
- **FCM token registration via heartbeat (Plan 3c).** The device adds `fcm_token: <token>` to its `HeartbeatPayload`; `devices-heartbeat` Edge Function writes it to `devices.fcm_token` (conditional, same pattern as the other observability fields). No dedicated `devices-fcm-register` endpoint — the heartbeat path is enough.
- **Cache LRU eviction triggers inside `MediaDownloader.download()` (Plan 3c).** `CacheManager.ensureFreeSpaceFor(bytes, referencedMediaIds)` deletes oldest non-referenced files until the target is free (or returns false, signalling InsufficientSpace). Safety margin 32 MB by default. Never evicts currently-referenced media.
- **Preload-via-USB scan timing (Plan 3c).** `PreloadScanner.scanOnce(config)` runs at `coordinator.start()` and on every new config emission. Files in `<cache_root>/../preload/` are hashed (skip via `preload_index.db` on size+mtime match); matches against current-config checksums are atomic-moved into the media cache. Unmatched files are reported in `cache_storage_info.preload.unmatched` for operator visibility.
- **Error bus drains per heartbeat tick (Plan 3c).** `ErrorBus.report(kind, mediaId, message)` buffers events in a bounded FIFO (default cap 32). `HeartbeatScheduler.sendOne()` calls `drain()` and inserts into the payload's `errors_since_last_heartbeat`. Events are NOT re-enqueued on heartbeat failure — single-send-best-effort matches spec §8 semantics.
- **`google-services.json` is gitignored.** Repo-root `.gitignore` + `android-tv/app/.gitignore` both exclude it. Firebase project + `SERVICE_ACCOUNT_JSON` (server side) must match or FCM sends land in the void.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): plan 3c shipped — FCM + boot + hardening + preload + LRU"
```

### Task 8.2 — End-of-plan commit

**Files:** none

- [ ] **Step 1: Empty close commit**

```bash
git commit --allow-empty -m "feat(android): plan 3c — FCM + boot + hardening + preload + LRU + error bus live"
```

---

## Appendix A — Acceptance matrix

| Scenario | Expected behavior |
|---|---|
| Fresh install + pair | Pairs within ≤ 3 s; first heartbeat carries `fcm_token` non-null within ≤ 90 s. |
| Dashboard Sync Now | Device fires `GET devices-config` within ≤ 5 s of the click (FCM path). Fallback if FCM fails: ≤ 60 s poll. |
| Device rebooted | Within ≤ 30 s of boot, `SignageService` is running and heartbeat is firing. Playback resumes without operator action. If `BootReceiver.startActivity` fails due to OS restrictions, service is still running; operator presses Home → Signage Player. |
| Preload file matches config | Within one scan (startup or new config), file is atomic-moved to cache; `cache_events` reports `state=preloaded`; heartbeat's `cache_storage_info.preload.matched_count` increments. |
| Preload file doesn't match | Listed in `cache_storage_info.preload.unmatched` with filename + size + sha256. File is NEVER auto-deleted. |
| Cache full + new media needed | `CacheEvictor.plan()` evicts oldest non-referenced. If no eligible candidates, download is skipped with `InsufficientSpace` and `reporter.failed(mediaId, "cache full...")`. |
| Playback error (codec, corrupted file) | Event lands in `ErrorBus`, shipped in next heartbeat under `errors_since_last_heartbeat`. PlaybackDirector skips to next item. |
| FCM token rotates | `onNewToken` updates `FcmTokenSource`; next heartbeat ships the fresh token; server updates `devices.fcm_token`. |
| OS kills service under memory pressure | `START_STICKY` means system re-launches; `onStartCommand` re-invokes `coordinator.start()` (idempotent). |

## Appendix B — Explicit non-goals for 3c

- **Server-side persistence of `errors_since_last_heartbeat`.** Device emits them; server logs count only. Persisting into a `device_error_events` table + dashboard "Recent errors" card is a follow-up plan (~6 tasks: migration + Edge Function write + dashboard surface).
- **APK self-update.** v1.1 per spec §11.
- **Signed preload manifests.** v1.1.
- **Retry on FCM send failure.** Fire-and-forget per spec §6.4.
- **Dashboard changes.** No new UI in 3c. Existing heartbeat fields already rendered; `preload` summary, `errors_since_last_heartbeat`, and `fcm_token` land in the DB but aren't surfaced visually yet.

## Appendix C — Known risks specific to 3c

1. **MIUI TV forks may block `BOOT_COMPLETED` → `startActivity`.** Mitigation in code: fail-silent on the `startActivity` attempt; service still starts. Mitigation in ops: document "if auto-launch fails, press Home and open Signage Player" in the operator runbook. Risk will be surfaced in Phase 7 on physical hardware.
2. **FCM delivery unreliable on MIUI battery-restricted apps.** Spec Risk #3. Acceptable: 60 s config poll is baseline. If FCM drops, "Sync Now" just has up to 60 s latency.
3. **Android 14+ (API 34) foreground service type enforcement.** `FOREGROUND_SERVICE_DATA_SYNC` requires the permission declaration. Manifest has it; untrust verification is during Phase 6's emulator smoke + Phase 7 real-hardware.
4. **Preload scan on slow USB.** Hashing a 2 GB MP4 can take 30 s. `PreloadScanner` runs on `Dispatchers.IO` so it doesn't block playback. The cache-index skip (path+size+mtime) ensures it's one-shot per file.
5. **FCM token race: heartbeat posts before `FcmTokenSource.prime()` completes.** First few heartbeats after fresh install may carry `fcm_token=null`. Tolerable — within 1–2 minutes the token lands and subsequent heartbeats deliver it. "Sync Now" simply doesn't work until then (dashboard optimistically shows "triggered").
6. **Preload file on USB while USB is removed mid-scan.** `PreloadScanner.scanOnce` walks `listFiles` once; if files disappear mid-walk, `File.exists()` checks in the import step handle it silently. Next scan will pick up whatever's there.

---

**End of Plan 3c.**
