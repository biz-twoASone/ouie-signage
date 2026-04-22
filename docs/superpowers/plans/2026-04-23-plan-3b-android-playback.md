# Plan 3b — Android TV APK: heartbeat + config sync + Media3 playback

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Plan 3a pairing-only APK into a playing APK. After this plan, a paired Android TV device (a) heartbeats every 60 s so the dashboard shows it "online" with app version + clock skew + cache info, (b) polls `devices-config` every 60 s with ETag and diffs the media set, (c) downloads + sha256-verifies media files into a local cache, (d) evaluates dayparting rules + fallback playlist on device-local time, and (e) plays the resolved playlist through ExoPlayer (video) or a Compose image view (images) with per-item duration, looping at the end. "Preparing content…" and "No content configured" fallbacks per spec §6.3.

**Architecture:** Add a long-running `RunningCoordinator` singleton that owns a `MainScope` and drives three coroutines: the heartbeat ticker, the config poller, and the media sync worker. Each coroutine writes into shared `StateFlow`s (`ConfigStore.current`, `CacheManager.cached`, etc.). A `PlaybackDirector` observes those flows + `TimeZoneClock.now()` at ~1 Hz and emits `PlaybackState` into a `StateFlow` that `RunningScreen` collects and renders. Schedule evaluation is a pure function (`ScheduleResolver.resolve`) consuming cached rules. Cache layout is whichever dir has the most free space among `getExternalFilesDirs` candidates, with internal fallback. MediaCacheIndex is a tiny SQLite table. All network I/O goes through the existing `named("authed")` OkHttp client so `TokenAuthenticator` handles 401s transparently; when the authenticator clears tokens, the coordinator observes `AppState` and stops its loops.

**Tech Stack:** Same as 3a (Kotlin 2.1, Compose for TV, OkHttp 4 / Retrofit 2 / kotlinx.serialization, Koin 4) plus `androidx.media3.exoplayer` + `androidx.media3.ui` (declared in 3a's libs.versions.toml, already on the classpath), `java.time.*` (API 26+, no desugaring), `android.os.StatFs` for disk stats, and Android's built-in `SQLiteOpenHelper` for the cache index.

**Out of scope for 3b (reserved for 3c + beyond):**
- FCM (`FirebaseMessagingService`, `google-services.json`). "Sync Now" from the dashboard is still posted to the server (already exists) but the device ignores FCM; config polling at 60 s is the path. Dashboard behavior unchanged — it already shows sync optimistically.
- `BOOT_COMPLETED` / `QUICKBOOT_POWERON` receivers + `LEANBACK_LAUNCHER` banner hardening. Requires manual app launch after reboot in 3b.
- Foreground service (`START_STICKY`). Coordinator runs inside the Activity process; if the app is force-killed by the OS, playback stops.
- Preload-via-USB scan (`<cache_root>/../preload/`). The cache-root resolver still picks external dirs when available — it just doesn't scan a sibling preload folder. 3c.
- LRU eviction of orphaned cached media. 3b keeps GONE media on disk indefinitely (storage headroom is plentiful for v1 scale; operator-initiated full cache clear is via `pm clear` in emergencies). Add in 3c if real-usage telemetry shows churn.
- Instrumented (Espresso/UiAutomator) tests. JVM-only unit tests for pure logic; emulator smoke in Phase 8.
- Dashboard changes. None needed — all fields the device writes (heartbeat + cache_events + current_playlist_id) are already rendered by Plan 2's `/app/screens/[id]` detail view.

**Execution branch:** new branch `feature/plan-3b-android-playback` off `main` (Plan 3a merged at e8234a6). Agent's first act is `git checkout -b feature/plan-3b-android-playback`.

**End-of-plan commit:** `feat(android): plan 3b — heartbeat + config sync + playback live on emulator`

---

## Prerequisites — already satisfied by Plan 3a

- Android Studio 2024.2+ installed; `ANDROID_HOME` + `adb` on `PATH`.
- Emulator AVD `atv34` (Android TV, API 34 Google TV).
- `android-tv/` Gradle project + version catalog at `android-tv/gradle/libs.versions.toml`.
- Device pairing works end-to-end (Plan 3a acceptance passed 2026-04-22 on emulator; force-stop + relaunch verified).
- Supabase Edge Functions `devices-config`, `devices-heartbeat`, `devices-cache-status`, `devices-refresh` deployed to production project `swhwrlpoqjijxcvywzto`.
- `AppStateHolder`, `TokenSource`, `TokenStore`, `TokenAuthenticator`, `AuthInterceptor`, `ApiClient` already wired in `di/AppModule.kt`. In particular, the `named("authed")` `OkHttpClient` is built but currently unused — 3b is its first consumer.

**Agent check before starting Task 1.1:**
```bash
cd android-tv && ./gradlew :app:testDebugUnitTest   # Plan 3a tests must still be green
git branch --show-current                             # must be main (or a fresh branch cut from main)
```
If 3a tests fail, STOP. The 3b plan is layered on top of 3a's modules; do not proceed until the baseline is green.

---

## File structure

All additions are inside `android-tv/app/src/main/java/com/ouie/signage/`.

```
com/ouie/signage/
├── cache/                             # NEW
│   ├── CacheRootResolver.kt           # picks root dir (getExternalFilesDirs → internal fallback)
│   ├── CacheLayout.kt                 # pure: cache root → file paths for a given media_id+ext
│   ├── Checksum.kt                    # sha256 of a File using streaming digest
│   ├── MediaCacheIndex.kt             # SQLiteOpenHelper over `<root>/media.db`
│   └── CacheManager.kt                # orchestrator: fullyCached(playlist), present(media), record(cached)
├── config/                            # NEW
│   ├── ConfigDto.kt                   # kotlinx.serialization payload shape for devices-config
│   ├── ConfigStore.kt                 # persists last config JSON + ETag to context-private dir
│   ├── ConfigRepository.kt            # fetches with If-None-Match, diffs media set, updates store
│   └── ConfigPoller.kt                # 60 s coroutine loop
├── schedule/                          # NEW (pure logic)
│   ├── ScheduleResolver.kt            # input: rules+device+groups+now_local → output: playlist_id?
│   ├── TimeZoneClock.kt               # `now(zone)`; production impl wraps Clock.systemUTC, test impl overridable
│   └── SyncWindow.kt                  # isWithin(start, end, nowLocal) — handles wrap-at-midnight
├── sync/                              # NEW
│   ├── MediaDownloader.kt             # stream → temp → sha256 → atomic rename
│   ├── MediaSyncWorker.kt             # processes a queue of missing media, debounced re-trigger
│   └── CacheStatusReporter.kt         # batches cache_events; POST to devices-cache-status
├── heartbeat/                         # NEW
│   ├── HeartbeatPayload.kt            # builder + @Serializable shape
│   ├── HeartbeatScheduler.kt          # 60 s coroutine loop
│   ├── ClockSkewTracker.kt            # parses Date response header; exposes skew in seconds
│   └── CacheStorageInfoBuilder.kt     # fills spec §4 cache_storage_info shape
├── net/                               # extended
│   ├── ConfigApi.kt                   # Retrofit iface for devices-config (GET, ETag, suspend Response<ConfigDto>)
│   ├── HeartbeatApi.kt                # Retrofit iface for devices-heartbeat (POST Unit)
│   ├── CacheStatusApi.kt              # Retrofit iface for devices-cache-status (POST Unit)
│   └── DateHeaderInterceptor.kt       # grabs the Date: response header for ClockSkewTracker
├── playback/                          # NEW
│   ├── PlaybackState.kt               # sealed interface: NoContent | Preparing | Playing | PlaybackError
│   ├── PlaybackDirector.kt            # coroutine ticker (1 Hz); picks desired; holds PlaybackState flow
│   ├── PlaybackItem.kt                # normalised item: mediaId, kind, localFile, durationSeconds
│   ├── PlaybackScreen.kt              # Compose host; chooses video vs image per item
│   ├── VideoPlayerHost.kt             # AndroidView(PlayerView), creates/releases ExoPlayer
│   ├── ImageSlideHost.kt              # Image composable + duration-based advance via PlaybackDirector
│   └── NoContentScreen.kt             # "No content configured" black screen with small caption
├── coordinator/                       # NEW
│   └── RunningCoordinator.kt          # single Koin; start()/stop() wires heartbeat+config+sync loops
├── running/                           # RE-WRITTEN
│   └── RunningScreen.kt               # hosts PlaybackScreen, collects PlaybackState flow
├── MainActivity.kt                    # MODIFIED — inject coordinator; start/stop with AppState
└── di/
    └── AppModule.kt                   # MODIFIED — register everything above
```

**New tests (JVM, src/test/java/com/ouie/signage/):**

```
cache/
  CacheRootResolverTest.kt    // happy path + degraded fallback (uses fake dir list)
  ChecksumTest.kt             // known-file + known-hash vector
  CacheLayoutTest.kt          // pure path math
config/
  ConfigRepositoryTest.kt     // MockWebServer: 200 with ETag, 304, diff emission
  ConfigStoreTest.kt          // write + read-back persistence
schedule/
  ScheduleResolverTest.kt     // device-specific beats group; effective_at wins within scope; no match → fallback
  SyncWindowTest.kt           // normal window, midnight-crossing window
sync/
  MediaDownloaderTest.kt      // MockWebServer: success, sha256 mismatch, mid-stream failure
heartbeat/
  HeartbeatPayloadTest.kt     // round-trip JSON shape matches spec §4
  ClockSkewTrackerTest.kt     // Date header parsed; negative + positive skew
playback/
  PlaybackDirectorTest.kt     // tick advances item; fully-cached switch; incomplete-cache keeps current
```

No changes to dashboard, Supabase, or SQL.

---

# Phase 0 — Branch cut + libs bump

Goal: a short, isolated phase that sets the stage without any production code.

### Task 0.1 — Branch + minor dependency additions

**Files:**
- Modify: `android-tv/gradle/libs.versions.toml`

- [ ] **Step 1: Create the execution branch**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feature/plan-3b-android-playback
```

- [ ] **Step 2: Add test-only Robolectric-free helpers (pinned versions only)**

Open `android-tv/gradle/libs.versions.toml`. In `[versions]` add one line:

```toml
androidxTestCore = "1.6.1"
```

In `[libraries]` add:

```toml
androidx-test-core = { module = "androidx.test:core", version.ref = "androidxTestCore" }
```

We use this only if a test ever needs `InstrumentationRegistry`-style helpers; it keeps the coming phases' test setup ergonomic without pulling in Robolectric's Android shims (we're sticking to pure-JVM tests; this dep is a thin util). No module-level change yet.

- [ ] **Step 3: Sanity build + tests**

```bash
cd android-tv && ./gradlew :app:testDebugUnitTest
```

Expected: GREEN (Plan 3a's 3 test classes still pass).

- [ ] **Step 4: Commit**

```bash
git add android-tv/gradle/libs.versions.toml
git commit -m "chore(android): branch plan-3b — reserve androidx-test-core catalog entry"
```

---

# Phase 1 — Cache foundation

Goal: a local cache where we can put media files, look them up by `media_id`, verify checksums, and ask "is this playlist fully cached?". No network yet.

### Task 1.1 — `CacheLayout` (pure path math)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/cache/CacheLayout.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/cache/CacheLayoutTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/cache/CacheLayoutTest.kt
package com.ouie.signage.cache

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class CacheLayoutTest {

    @Test
    fun `media file path joins root, media subdir, id, and extension`() {
        val layout = CacheLayout(File("/some/cache"))
        val file = layout.mediaFile("abc-123", "mp4")
        assertEquals(File("/some/cache/media/abc-123.mp4"), file)
    }

    @Test
    fun `extension is derived from r2 path when caller does not have it explicitly`() {
        assertEquals("mp4", CacheLayout.extensionFromR2Path("/tenants/t/media/abc.mp4"))
        assertEquals("jpg", CacheLayout.extensionFromR2Path("/tenants/t/media/abc.jpg"))
        assertEquals("bin", CacheLayout.extensionFromR2Path("/tenants/t/media/no-extension"))
    }

    @Test
    fun `extension strips query string and fragment from signed r2 urls`() {
        assertEquals(
            "mp4",
            CacheLayout.extensionFromR2Path(
                "https://acct.r2.cloudflarestorage.com/tenants/t/media/abc.mp4?X-Amz-Signature=abc&X-Amz-Date=2026",
            ),
        )
        assertEquals("jpg", CacheLayout.extensionFromR2Path("https://host/abc.jpg#frag"))
    }

    @Test
    fun `temp file path is a sibling with .part suffix`() {
        val layout = CacheLayout(File("/x"))
        assertEquals(File("/x/media/id.mp4.part"), layout.tempFile("id", "mp4"))
    }

    @Test
    fun `db file is under root`() {
        assertEquals(File("/x/media.db"), CacheLayout(File("/x")).indexDbFile())
    }
}
```

- [ ] **Step 2: Run the test — expect COMPILATION FAILURE**

```bash
cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.cache.CacheLayoutTest"
```

Expected: unresolved reference `CacheLayout`.

- [ ] **Step 3: Implement `CacheLayout.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/cache/CacheLayout.kt
package com.ouie.signage.cache

import java.io.File

/**
 * Pure file-path math for the on-disk layout described in spec §6.5:
 *   <root>/media/<media_id>.<ext>
 *   <root>/media.db
 * The "media" subdirectory groups cached blobs so later tooling (3c preload,
 * cache-clear) can operate on a single folder. Temp files use a `.part`
 * suffix and live in the same folder so the final rename is a same-volume
 * atomic rename.
 */
class CacheLayout(val root: File) {

    fun mediaDir(): File = File(root, "media")

    fun mediaFile(mediaId: String, ext: String): File =
        File(mediaDir(), "$mediaId.$ext")

    fun tempFile(mediaId: String, ext: String): File =
        File(mediaDir(), "$mediaId.$ext.part")

    fun indexDbFile(): File = File(root, "media.db")

    companion object {
        /**
         * Extract the file extension from an R2 object key OR a signed R2 URL.
         * Strips any query string (`?X-Amz-Signature=…`) or fragment before
         * finding the last dot, since MediaSyncWorker hands us the full signed
         * URL directly. If no extension is present, returns "bin".
         */
        fun extensionFromR2Path(r2Path: String): String {
            val pathPart = r2Path.substringBefore('?').substringBefore('#')
            val slash = pathPart.lastIndexOf('/')
            val dot = pathPart.lastIndexOf('.')
            return if (dot > slash && dot < pathPart.length - 1) pathPart.substring(dot + 1).lowercase()
                   else "bin"
        }
    }
}
```

- [ ] **Step 4: Run the test — expect GREEN (4 passed)**

```bash
cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.cache.CacheLayoutTest"
```

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/cache/CacheLayout.kt \
        android-tv/app/src/test/java/com/ouie/signage/cache/CacheLayoutTest.kt
git commit -m "feat(android): CacheLayout — on-disk paths for media cache + temp + index db"
```

### Task 1.2 — `Checksum.kt` (streaming sha256)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/cache/Checksum.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/cache/ChecksumTest.kt`

- [ ] **Step 1: Write the failing test with a known-hash fixture**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/cache/ChecksumTest.kt
package com.ouie.signage.cache

import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ChecksumTest {

    @get:Rule val tmp = TemporaryFolder()

    @Test
    fun `sha256 of known content matches known digest`() {
        // echo -n "hello" | shasum -a 256
        //   → 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
        val f = tmp.newFile("x.bin").apply { writeText("hello") }
        assertEquals(
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
            Checksum.sha256OfFile(f),
        )
    }

    @Test
    fun `sha256 streams large-ish input without oom`() {
        val f = tmp.newFile("big.bin")
        // 4 MB of deterministic content
        f.outputStream().use { out ->
            val chunk = ByteArray(4096) { (it % 256).toByte() }
            repeat(1024) { out.write(chunk) }
        }
        val hash = Checksum.sha256OfFile(f)
        assertEquals(64, hash.length)
        assertEquals(hash, hash.lowercase())  // lowercase hex
    }
}
```

- [ ] **Step 2: Run — expect RED (Checksum unresolved)**

```bash
cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.cache.ChecksumTest"
```

- [ ] **Step 3: Implement `Checksum.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/cache/Checksum.kt
package com.ouie.signage.cache

import java.io.File
import java.security.MessageDigest

object Checksum {

    private const val BUFFER_BYTES = 64 * 1024

    /**
     * Streams the file through SHA-256 and returns the lowercase hex digest.
     * Spec §4 stores checksums as lowercase hex (same format minted by the
     * dashboard's R2 upload pre-sign step), so we match that exactly.
     */
    fun sha256OfFile(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(BUFFER_BYTES)
            while (true) {
                val n = input.read(buf)
                if (n <= 0) break
                digest.update(buf, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
```

- [ ] **Step 4: Run — expect GREEN (2 passed)**

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/cache/Checksum.kt \
        android-tv/app/src/test/java/com/ouie/signage/cache/ChecksumTest.kt
git commit -m "feat(android): Checksum.sha256OfFile — streaming digest, lowercase hex"
```

### Task 1.3 — `CacheRootResolver` (three-tier selection)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/cache/CacheRootResolver.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/cache/CacheRootResolverTest.kt`

Design note: the resolver takes a list of `(File dir, Long freeBytes, Boolean isExternal)` tuples and applies the picking rule. We wrap the Android API at the call-site in Phase 7 (the Coordinator) — the resolver itself is pure and trivially testable on the JVM.

- [ ] **Step 1: Write the failing test**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/cache/CacheRootResolverTest.kt
package com.ouie.signage.cache

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class CacheRootResolverTest {

    private val internalDir = File("/internal")
    private val usb = File("/usb")
    private val sd = File("/sd")

    @Test
    fun `picks external with highest free bytes when above threshold`() {
        val pick = CacheRootResolver.pick(
            candidates = listOf(
                CacheRootResolver.Candidate(usb, freeBytes = 20L * 1024 * 1024 * 1024, isExternal = true),
                CacheRootResolver.Candidate(sd,  freeBytes = 10L * 1024 * 1024 * 1024, isExternal = true),
            ),
            internalDir = internalDir,
            internalFreeBytes = 8L * 1024 * 1024 * 1024,
            minExternalBytes = 4L * 1024 * 1024 * 1024,
        )
        assertEquals(usb, pick.root)
        assertEquals(CacheRootResolver.Kind.External, pick.kind)
        assertEquals(false, pick.degraded)
    }

    @Test
    fun `falls back to internal when all externals below threshold`() {
        val pick = CacheRootResolver.pick(
            candidates = listOf(
                CacheRootResolver.Candidate(usb, freeBytes = 1L * 1024 * 1024 * 1024, isExternal = true),
            ),
            internalDir = internalDir,
            internalFreeBytes = 8L * 1024 * 1024 * 1024,
            minExternalBytes = 4L * 1024 * 1024 * 1024,
        )
        assertEquals(internalDir, pick.root)
        assertEquals(CacheRootResolver.Kind.Internal, pick.kind)
        assertEquals(true, pick.degraded)
    }

    @Test
    fun `falls back to internal when no externals returned`() {
        val pick = CacheRootResolver.pick(
            candidates = emptyList(),
            internalDir = internalDir,
            internalFreeBytes = 8L * 1024 * 1024 * 1024,
            minExternalBytes = 4L * 1024 * 1024 * 1024,
        )
        assertEquals(internalDir, pick.root)
        assertEquals(CacheRootResolver.Kind.Internal, pick.kind)
        assertEquals(true, pick.degraded)
    }

    @Test
    fun `prefers internal only when external dominates by free space`() {
        // Even if internal has a lot free, an external above threshold wins — spec §6.5.
        val pick = CacheRootResolver.pick(
            candidates = listOf(
                CacheRootResolver.Candidate(usb, freeBytes = 5L * 1024 * 1024 * 1024, isExternal = true),
            ),
            internalDir = internalDir,
            internalFreeBytes = 50L * 1024 * 1024 * 1024,
            minExternalBytes = 4L * 1024 * 1024 * 1024,
        )
        assertEquals(usb, pick.root)
        assertEquals(CacheRootResolver.Kind.External, pick.kind)
    }
}
```

- [ ] **Step 2: Run — expect RED**

- [ ] **Step 3: Implement `CacheRootResolver.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/cache/CacheRootResolver.kt
package com.ouie.signage.cache

import java.io.File

/**
 * Picks the cache root from a list of external candidates, falling back to
 * an internal directory when no external dir has enough free space.
 *
 * Spec §6.5: prefer external when any external candidate has ≥ `minExternalBytes`
 * free; among those, the one with the most free bytes wins. Otherwise fall back
 * to internal and mark the pick as `degraded` so the dashboard surfaces a warning
 * via `cache_storage_info.degraded` in heartbeat.
 *
 * The Android-specific step of turning Context.getExternalFilesDirs() + StorageManager
 * results into Candidate instances lives in CacheStorageInfoBuilder (Phase 5); this
 * module is pure so it can be JVM-unit-tested.
 */
object CacheRootResolver {

    enum class Kind { External, Internal }

    data class Candidate(
        val dir: File,
        val freeBytes: Long,
        val isExternal: Boolean,
    )

    data class Pick(
        val root: File,
        val kind: Kind,
        val freeBytes: Long,
        /** True when we fell back to internal because no external was viable. */
        val degraded: Boolean,
    )

    fun pick(
        candidates: List<Candidate>,
        internalDir: File,
        internalFreeBytes: Long,
        minExternalBytes: Long,
    ): Pick {
        val viable = candidates.filter { it.isExternal && it.freeBytes >= minExternalBytes }
        val best = viable.maxByOrNull { it.freeBytes }
        return if (best != null) {
            Pick(root = best.dir, kind = Kind.External, freeBytes = best.freeBytes, degraded = false)
        } else {
            Pick(root = internalDir, kind = Kind.Internal, freeBytes = internalFreeBytes, degraded = true)
        }
    }
}
```

- [ ] **Step 4: Run — expect GREEN (4 passed)**

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/cache/CacheRootResolver.kt \
        android-tv/app/src/test/java/com/ouie/signage/cache/CacheRootResolverTest.kt
git commit -m "feat(android): CacheRootResolver — prefer external ≥ threshold, flag internal fallback as degraded"
```

### Task 1.4 — `MediaCacheIndex` (SQLite-backed)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/cache/MediaCacheIndex.kt`

**Note:** SQLite requires an Android `Context` and is not JVM-testable without Robolectric. We cover this module end-to-end via the emulator acceptance in Phase 8. The API surface is deliberately small — three methods + a row class — so the risk is contained.

- [ ] **Step 1: Write `MediaCacheIndex.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/cache/MediaCacheIndex.kt
package com.ouie.signage.cache

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.io.File

/**
 * Tracks every media blob we've cached. One row per media_id. The `path` column
 * stores the absolute file path so a cache-root change (e.g. USB re-mounted on a
 * different letter) would invalidate everything — which is what we want.
 *
 * We do NOT use Room because:
 *   1. Single table, no migrations expected during v1.
 *   2. Avoids pulling kapt/ksp into the build.
 *
 * The `helper` is tied to the cache root's index file; callers create a fresh
 * `MediaCacheIndex` when the resolver picks a different root (e.g., USB plugged
 * or unplugged). `CacheManager` does this.
 */
class MediaCacheIndex(context: Context, dbFile: File) {

    private val helper = object : SQLiteOpenHelper(
        context.applicationContext,
        dbFile.absolutePath,  // absolute path → DB lives at <cache_root>/media.db
        /* factory = */ null,
        DB_VERSION,
    ) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL("""
                CREATE TABLE $TABLE (
                    media_id TEXT PRIMARY KEY,
                    ext TEXT NOT NULL,
                    checksum TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    cached_at INTEGER NOT NULL,
                    last_played_at INTEGER
                )
            """.trimIndent())
        }
        override fun onUpgrade(db: SQLiteDatabase, oldV: Int, newV: Int) {
            // No migrations yet. If we ever bump DB_VERSION, drop+recreate is fine —
            // the files are still on disk; next config sync will re-insert rows.
            db.execSQL("DROP TABLE IF EXISTS $TABLE")
            onCreate(db)
        }
    }

    data class Entry(
        val mediaId: String,
        val ext: String,
        val checksum: String,
        val sizeBytes: Long,
        val cachedAtEpochSeconds: Long,
        val lastPlayedAtEpochSeconds: Long?,
    )

    fun upsert(entry: Entry) {
        helper.writableDatabase.insertWithOnConflict(
            TABLE,
            null,
            ContentValues().apply {
                put("media_id", entry.mediaId)
                put("ext", entry.ext)
                put("checksum", entry.checksum)
                put("size_bytes", entry.sizeBytes)
                put("cached_at", entry.cachedAtEpochSeconds)
                entry.lastPlayedAtEpochSeconds?.let { put("last_played_at", it) }
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    fun find(mediaId: String): Entry? {
        helper.readableDatabase.rawQuery(
            "SELECT ext, checksum, size_bytes, cached_at, last_played_at FROM $TABLE WHERE media_id = ?",
            arrayOf(mediaId),
        ).use { c ->
            if (!c.moveToFirst()) return null
            return Entry(
                mediaId = mediaId,
                ext = c.getString(0),
                checksum = c.getString(1),
                sizeBytes = c.getLong(2),
                cachedAtEpochSeconds = c.getLong(3),
                lastPlayedAtEpochSeconds = if (c.isNull(4)) null else c.getLong(4),
            )
        }
    }

    fun markPlayed(mediaId: String, epochSeconds: Long) {
        helper.writableDatabase.execSQL(
            "UPDATE $TABLE SET last_played_at = ? WHERE media_id = ?",
            arrayOf<Any>(epochSeconds, mediaId),
        )
    }

    fun delete(mediaId: String) {
        helper.writableDatabase.delete(TABLE, "media_id = ?", arrayOf(mediaId))
    }

    private companion object {
        const val DB_VERSION = 1
        const val TABLE = "media_cache"
    }
}
```

- [ ] **Step 2: Build-only verification (no test target — covered in Phase 8)**

```bash
cd android-tv && ./gradlew :app:assembleDebug
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/cache/MediaCacheIndex.kt
git commit -m "feat(android): MediaCacheIndex — SQLiteOpenHelper over media.db, single-table schema"
```

### Task 1.5 — `CacheManager` (orchestration surface used elsewhere)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/cache/CacheManager.kt`

`CacheManager` wraps the `MediaCacheIndex`, a `CacheLayout`, and exposes the two predicates the rest of 3b depends on: "is this media present + checksum-OK?" and "is this playlist fully cached?". It also emits a `StateFlow<Set<String>>` of cached media IDs so the playback director can react to cache changes without polling.

- [ ] **Step 1: Write `CacheManager.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/cache/CacheManager.kt
package com.ouie.signage.cache

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File

/**
 * Owns the authoritative view of what's on disk + what's safe to play. The
 * SQLite index is write-through: every `markCached` updates both the row and
 * the `cached` flow in one call. Consumers that care about playability only
 * need the flow.
 *
 * Thread-safety: all mutations go through the SQLiteOpenHelper (internally
 * serialized) plus StateFlow (compare-and-set). Safe to call from any thread
 * including OkHttp's worker pool.
 */
class CacheManager(
    val layout: CacheLayout,
    private val index: MediaCacheIndex,
) {

    private val _cached = MutableStateFlow<Set<String>>(emptySet())
    val cached: StateFlow<Set<String>> = _cached.asStateFlow()

    /**
     * Re-reads every index row at startup so `cached` reflects whatever
     * survived the previous process. Missing-file rows are pruned (row says
     * "cached" but disk disagrees — operator may have wiped the folder).
     */
    fun rehydrate(allKnownMediaIds: Iterable<String>) {
        val present = mutableSetOf<String>()
        for (id in allKnownMediaIds) {
            val row = index.find(id) ?: continue
            val file = layout.mediaFile(id, row.ext)
            if (file.exists() && file.length() == row.sizeBytes) {
                present += id
            } else {
                // Out-of-band delete — row is stale, drop it.
                index.delete(id)
            }
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
        return _cached.value.containsAll(mediaIds)
    }
}
```

- [ ] **Step 2: Build verification**

```bash
cd android-tv && ./gradlew :app:assembleDebug
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/cache/CacheManager.kt
git commit -m "feat(android): CacheManager — flow-backed view of cached media + SQLite rehydrate"
```

---

# Phase 2 — Config DTOs + store + repository

Goal: fetch `devices-config` with ETag caching, parse it, persist it, and emit a `StateFlow<ConfigDto?>` for downstream consumers.

### Task 2.1 — `ConfigDto.kt` (payload shape)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/config/ConfigDto.kt`

The shape below mirrors the canonical JSON emitted by `supabase/functions/devices-config/index.ts` verbatim (see top-level `version`, `device`, `rules`, `playlists`, `media`). Field names use `snake_case` to match the wire format; `ignoreUnknownKeys = true` in `ApiClient.json` means the device stays forward-compatible if the server adds new fields.

- [ ] **Step 1: Write `ConfigDto.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/config/ConfigDto.kt
package com.ouie.signage.config

import kotlinx.serialization.Serializable

@Serializable
data class ConfigDto(
    val version: String,        // e.g., "sha256:abc123..."
    val device: DeviceDto,
    val rules: List<RuleDto> = emptyList(),
    val playlists: List<PlaylistDto> = emptyList(),
    val media: List<MediaDto> = emptyList(),
)

@Serializable
data class DeviceDto(
    val id: String,
    val store_id: String,
    val fallback_playlist_id: String? = null,
    val timezone: String,       // IANA, e.g., "Asia/Jakarta"
)

@Serializable
data class RuleDto(
    val id: String,
    val playlist_id: String,
    val target_device_id: String? = null,
    val target_device_group_id: String? = null,
    val days_of_week: List<Int>,      // ISO 1=Mon..7=Sun
    val start_time: String,            // "HH:MM:SS" (Postgres `time` stringification)
    val end_time: String,
    val effective_at: String,          // ISO-8601 UTC
)

@Serializable
data class PlaylistDto(
    val id: String,
    val name: String,
    val updated_at: String,
    val items: List<PlaylistItemDto>,
)

@Serializable
data class PlaylistItemDto(
    val media_id: String,
    val position: Int,
    val duration_seconds: Double? = null,
)

@Serializable
data class MediaDto(
    val id: String,
    val kind: String,                 // "video" | "image"
    val size_bytes: Long,
    val checksum: String,             // lowercase hex sha256
    val video_duration_seconds: Double? = null,
    val url: String,                  // signed R2 GET URL, 24h TTL
)
```

- [ ] **Step 2: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/config/ConfigDto.kt
git commit -m "feat(android): ConfigDto — serialization shape mirroring devices-config payload"
```

### Task 2.2 — `ConfigStore.kt` (persists the last good config)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/config/ConfigStore.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/config/ConfigStoreTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/config/ConfigStoreTest.kt
package com.ouie.signage.config

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ConfigStoreTest {

    @get:Rule val tmp = TemporaryFolder()

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Test
    fun `save and load roundtrip`() {
        val store = ConfigStore(tmp.newFolder(), json)
        val cfg = ConfigDto(
            version = "sha256:abc",
            device = DeviceDto("dev-1", "store-1", null, "Asia/Jakarta"),
        )
        store.save(cfg, eTag = "\"sha256:abc\"")

        val loaded = store.loadConfig()
        val tag = store.loadETag()
        assertEquals(cfg, loaded)
        assertEquals("\"sha256:abc\"", tag)
    }

    @Test
    fun `loadConfig returns null before first save`() {
        val store = ConfigStore(tmp.newFolder(), json)
        assertNull(store.loadConfig())
        assertNull(store.loadETag())
    }

    @Test
    fun `corrupt stored config is dropped silently`() {
        val dir = tmp.newFolder()
        java.io.File(dir, "config.json").writeText("this is not json {")
        java.io.File(dir, "config.etag").writeText("\"sha256:xyz\"")
        val store = ConfigStore(dir, json)
        assertNull(store.loadConfig())
        // ETag is still present; we'll happily re-send it with the next GET
        // and the server will reply 200 with fresh config.
        assertEquals("\"sha256:xyz\"", store.loadETag())
    }
}
```

- [ ] **Step 2: Run — expect RED**

- [ ] **Step 3: Implement `ConfigStore.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/config/ConfigStore.kt
package com.ouie.signage.config

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.io.File

/**
 * Persists the last good config + its ETag on disk. Both pieces are needed
 * for the If-None-Match round-trip that keeps polling cheap (spec §6.1).
 * Corrupt config JSON is ignored so a partial-write crash doesn't brick the
 * app; the next 200 response will overwrite both files.
 *
 * This lives under `context.filesDir/signage` so it's process-private and
 * survives upgrades. It is NOT in the cache dir — we want these files to
 * survive Android's low-storage cache auto-clear.
 */
class ConfigStore(
    private val dir: File,
    private val json: Json,
) {

    init { dir.mkdirs() }

    private val configFile get() = File(dir, "config.json")
    private val etagFile   get() = File(dir, "config.etag")

    fun save(config: ConfigDto, eTag: String?) {
        configFile.writeText(json.encodeToString(ConfigDto.serializer(), config))
        if (eTag != null) etagFile.writeText(eTag) else etagFile.delete()
    }

    fun loadConfig(): ConfigDto? {
        if (!configFile.exists()) return null
        return try {
            json.decodeFromString(ConfigDto.serializer(), configFile.readText())
        } catch (e: SerializationException) {
            null
        }
    }

    fun loadETag(): String? =
        if (etagFile.exists()) etagFile.readText().trim().ifBlank { null } else null
}
```

- [ ] **Step 4: Run — expect GREEN (3 passed)**

```bash
cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.config.ConfigStoreTest"
```

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/config/ConfigStore.kt \
        android-tv/app/src/test/java/com/ouie/signage/config/ConfigStoreTest.kt
git commit -m "feat(android): ConfigStore — persist config JSON + ETag, tolerate corrupt write"
```

### Task 2.3 — `ConfigApi.kt` (Retrofit interface)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/net/ConfigApi.kt`

- [ ] **Step 1: Write `ConfigApi.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/net/ConfigApi.kt
package com.ouie.signage.net

import com.ouie.signage.config.ConfigDto
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Header

interface ConfigApi {

    /**
     * Returns 200 with the full body when the device's last known ETag is
     * stale (or missing), or 304 with no body when it's current. Pass null
     * as `ifNoneMatch` on the first call.
     *
     * Retrofit typechecks `Response<ConfigDto>` so the caller can inspect
     * `.code()` for the 304 path without going through exception flow.
     */
    @GET("devices-config")
    suspend fun fetch(
        @Header("If-None-Match") ifNoneMatch: String? = null,
    ): Response<ConfigDto>
}
```

- [ ] **Step 2: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/net/ConfigApi.kt
git commit -m "feat(android): ConfigApi — Retrofit interface for devices-config with If-None-Match"
```

### Task 2.4 — `ConfigRepository.kt` (fetch + diff + persist)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/config/ConfigRepository.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/config/ConfigRepositoryTest.kt`

- [ ] **Step 1: Write the failing test with MockWebServer**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/config/ConfigRepositoryTest.kt
package com.ouie.signage.config

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.ouie.signage.net.ConfigApi
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import retrofit2.Retrofit

class ConfigRepositoryTest {

    @get:Rule val tmp = TemporaryFolder()

    private lateinit var server: MockWebServer
    private lateinit var api: ConfigApi
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
        api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ConfigApi::class.java)
    }

    @After fun tearDown() { server.shutdown() }

    @Test
    fun `200 with ETag persists config and emits new version`() = runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("ETag", "\"sha256:v1\"")
                .setBody(
                    """{"version":"sha256:v1","device":{"id":"d1","store_id":"s1","timezone":"Asia/Jakarta"}}"""
                ),
        )
        val store = ConfigStore(tmp.newFolder(), json)
        val repo = ConfigRepository(api, store)

        val result = repo.fetch()

        assertEquals(ConfigRepository.Result.Applied("sha256:v1"), result)
        val saved = store.loadConfig()
        assertNotNull(saved)
        assertEquals("sha256:v1", saved!!.version)
        assertEquals("\"sha256:v1\"", store.loadETag())
    }

    @Test
    fun `304 returns NotModified without touching store`() = runBlocking {
        val store = ConfigStore(tmp.newFolder(), json)
        // Prime the store with v1
        store.save(
            ConfigDto("sha256:v1", DeviceDto("d1", "s1", null, "Asia/Jakarta")),
            eTag = "\"sha256:v1\"",
        )
        server.enqueue(MockResponse().setResponseCode(304))

        val repo = ConfigRepository(api, store)
        val result = repo.fetch()

        assertEquals(ConfigRepository.Result.NotModified, result)
        // The request we sent must have echoed the previous ETag.
        val sent = server.takeRequest()
        assertEquals("\"sha256:v1\"", sent.getHeader("If-None-Match"))
    }

    @Test
    fun `5xx surfaces as Error without corrupting store`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503))
        val store = ConfigStore(tmp.newFolder(), json)
        val repo = ConfigRepository(api, store)

        val result = repo.fetch()

        assertEquals(true, result is ConfigRepository.Result.Error)
        assertNull(store.loadConfig())
    }
}
```

- [ ] **Step 2: Run — expect RED**

- [ ] **Step 3: Implement `ConfigRepository.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/config/ConfigRepository.kt
package com.ouie.signage.config

import com.ouie.signage.net.ConfigApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Thin wrapper around ConfigApi + ConfigStore. Emits the current config as a
 * StateFlow (seeded from disk on init) so downstream consumers (the schedule
 * resolver, the sync worker) can react to new versions without polling the
 * store.
 *
 * Error policy (spec §7): any non-success response (401 → TokenAuthenticator
 * handles; other 4xx/5xx → `Result.Error`) leaves the stored config untouched.
 * Callers keep playing whatever was last good.
 */
class ConfigRepository(
    private val api: ConfigApi,
    private val store: ConfigStore,
) {

    sealed interface Result {
        data class Applied(val version: String) : Result
        data object NotModified : Result
        data class Error(val cause: Throwable?) : Result
    }

    private val _current = MutableStateFlow(store.loadConfig())
    val current: StateFlow<ConfigDto?> = _current.asStateFlow()

    suspend fun fetch(): Result {
        val resp = try {
            api.fetch(ifNoneMatch = store.loadETag())
        } catch (e: CancellationException) {
            throw e
        } catch (t: Throwable) {
            return Result.Error(t)
        }

        return when (resp.code()) {
            200 -> {
                val body = resp.body() ?: return Result.Error(null)
                store.save(body, resp.headers()["ETag"])
                _current.value = body
                Result.Applied(body.version)
            }
            304 -> Result.NotModified
            else -> Result.Error(RuntimeException("devices-config HTTP ${resp.code()}"))
        }
    }
}
```

- [ ] **Step 4: Run — expect GREEN (3 passed)**

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/config/ConfigRepository.kt \
        android-tv/app/src/test/java/com/ouie/signage/config/ConfigRepositoryTest.kt
git commit -m "feat(android): ConfigRepository — ETag-aware fetch, persist, expose current as StateFlow"
```

### Task 2.5 — `ConfigPoller.kt` (60 s loop)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/config/ConfigPoller.kt`

- [ ] **Step 1: Write `ConfigPoller.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/config/ConfigPoller.kt
package com.ouie.signage.config

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Runs ConfigRepository.fetch() every [intervalMs], with exponential backoff on
 * Error (1, 2, 4, 8, capped at interval). Idempotent start/stop; called by
 * RunningCoordinator.
 *
 * Backoff reasoning (spec §7): transient network / 5xx should NOT hammer the
 * server or drain the device's connection. We max-out at the same interval we
 * normally poll at — the fallback path's floor is "one poll per minute", which
 * the dashboard already tolerates.
 */
class ConfigPoller(
    private val scope: CoroutineScope,
    private val repo: ConfigRepository,
    private val intervalMs: Long = 60_000,
) {

    private var job: Job? = null

    fun start() {
        if (job?.isActive == true) return
        job = scope.launch {
            var backoff = 1_000L
            while (true) {
                val result = repo.fetch()
                try {
                    when (result) {
                        is ConfigRepository.Result.Applied,
                        ConfigRepository.Result.NotModified -> {
                            backoff = 1_000L
                            delay(intervalMs)
                        }
                        is ConfigRepository.Result.Error -> {
                            delay(backoff)
                            backoff = (backoff * 2).coerceAtMost(intervalMs)
                        }
                    }
                } catch (e: CancellationException) {
                    throw e
                }
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }
}
```

- [ ] **Step 2: Build verification**

```bash
cd android-tv && ./gradlew :app:assembleDebug
```

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/config/ConfigPoller.kt
git commit -m "feat(android): ConfigPoller — 60s loop with exponential backoff on error"
```

---

# Phase 3 — Schedule resolver + sync window (pure logic)

Goal: JVM-unit-testable functions that turn "here's a config + here's now" into "playback is playlist X" — and let us decide whether to download media now or later.

### Task 3.1 — `TimeZoneClock.kt`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/schedule/TimeZoneClock.kt`

- [ ] **Step 1: Write `TimeZoneClock.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/schedule/TimeZoneClock.kt
package com.ouie.signage.schedule

import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Thin wrapper around Clock so tests can pin time to known instants. Production
 * code injects `TimeZoneClock()`; tests pass a fixed clock via
 * `TimeZoneClock(Clock.fixed(instant, zone))`.
 */
class TimeZoneClock(private val clock: Clock = Clock.systemUTC()) {
    fun nowInstant(): Instant = clock.instant()
    fun nowIn(zone: ZoneId): ZonedDateTime = ZonedDateTime.ofInstant(nowInstant(), zone)
}
```

- [ ] **Step 2: Commit (no unit test — it's a 3-line wrapper; it's exercised by every test in this phase and Phase 6)**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/schedule/TimeZoneClock.kt
git commit -m "feat(android): TimeZoneClock — injectable wrapper over java.time.Clock"
```

### Task 3.2 — `SyncWindow.kt` (pure)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/schedule/SyncWindow.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/schedule/SyncWindowTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/schedule/SyncWindowTest.kt
package com.ouie.signage.schedule

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalTime

class SyncWindowTest {

    @Test
    fun `normal window — inside returns true, outside returns false`() {
        val start = LocalTime.of(2, 0)
        val end = LocalTime.of(5, 0)
        assertEquals(true,  SyncWindow.isWithin(start, end, LocalTime.of(3, 0)))
        assertEquals(true,  SyncWindow.isWithin(start, end, LocalTime.of(2, 0)))  // start inclusive
        assertEquals(false, SyncWindow.isWithin(start, end, LocalTime.of(5, 0)))  // end exclusive
        assertEquals(false, SyncWindow.isWithin(start, end, LocalTime.of(1, 59)))
        assertEquals(false, SyncWindow.isWithin(start, end, LocalTime.of(5, 1)))
    }

    @Test
    fun `midnight-crossing window — 22 to 04 behaves correctly`() {
        val start = LocalTime.of(22, 0)
        val end = LocalTime.of(4, 0)
        assertEquals(true,  SyncWindow.isWithin(start, end, LocalTime.of(23, 0)))
        assertEquals(true,  SyncWindow.isWithin(start, end, LocalTime.of(0, 30)))
        assertEquals(true,  SyncWindow.isWithin(start, end, LocalTime.of(3, 59)))
        assertEquals(false, SyncWindow.isWithin(start, end, LocalTime.of(4, 0)))   // end exclusive
        assertEquals(false, SyncWindow.isWithin(start, end, LocalTime.of(21, 59)))
        assertEquals(false, SyncWindow.isWithin(start, end, LocalTime.of(12, 0)))
    }

    @Test
    fun `equal start and end is an empty window`() {
        val t = LocalTime.of(3, 0)
        assertEquals(false, SyncWindow.isWithin(t, t, LocalTime.of(3, 0)))
    }
}
```

- [ ] **Step 2: Run — expect RED**

- [ ] **Step 3: Implement `SyncWindow.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/schedule/SyncWindow.kt
package com.ouie.signage.schedule

import java.time.LocalTime

/**
 * Spec §6.2: the per-store sync window is stored as two `time` values in the
 * store's local timezone. If `end` is strictly after `start`, the window is
 * a single daily interval. If `end` is earlier than `start`, the window
 * crosses midnight. Equal values = empty window (nothing will ever match).
 *
 * Start is inclusive, end is exclusive — matching how SQL `time >= start AND
 * time < end` is generally written.
 */
object SyncWindow {
    fun isWithin(start: LocalTime, end: LocalTime, now: LocalTime): Boolean {
        if (start == end) return false
        return if (end.isAfter(start)) {
            !now.isBefore(start) && now.isBefore(end)
        } else {
            // Wraps midnight: match [start, 24:00) OR [00:00, end)
            !now.isBefore(start) || now.isBefore(end)
        }
    }
}
```

- [ ] **Step 4: Run — expect GREEN (3 passed)**

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/schedule/SyncWindow.kt \
        android-tv/app/src/test/java/com/ouie/signage/schedule/SyncWindowTest.kt
git commit -m "feat(android): SyncWindow.isWithin — normal and midnight-crossing intervals"
```

### Task 3.3 — `ScheduleResolver.kt` (pure, the core of playback)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/schedule/ScheduleResolver.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/schedule/ScheduleResolverTest.kt`

Implements the precedence rules from spec §4:
```
active_playlist(device, now_local) =
  first rule from {
    rules where target_device_id = device.id UNION
    rules where target_device_group_id IN (device's group IDs)
  } WHERE effective_at <= server_now
    AND now_local.weekday IN days_of_week
    AND start_time <= now_local.time <= end_time
  ORDER BY
    target_device_id IS NOT NULL DESC,
    effective_at DESC
  ELSE device.fallback_playlist_id
```

**Divergence note (important):** the Edge Function `supabase/functions/devices-config/index.ts` already filters rules server-side by BOTH `effective_at <= server_now` AND `(target_device_id = me OR target_device_group_id IN my_groups)`. That means every rule in the payload is already applicable to this device by scope. The device therefore does NOT re-check the scope clause and does NOT need to know its own group IDs. It only evaluates weekday + time-of-day and applies the device-beats-group + newer-effective_at tiebreakers. This avoids a server API change (no need to ship `device.group_ids` in the payload).

- [ ] **Step 1: Write the failing test (covers every branch)**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/schedule/ScheduleResolverTest.kt
package com.ouie.signage.schedule

import com.ouie.signage.config.DeviceDto
import com.ouie.signage.config.RuleDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Clock
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

class ScheduleResolverTest {

    private val jkt = ZoneId.of("Asia/Jakarta")
    private val device = DeviceDto(
        id = "dev-1",
        store_id = "store-1",
        fallback_playlist_id = "fallback",
        timezone = "Asia/Jakarta",
    )

    // Fixed "Monday 10:30 local Jakarta" for all tests
    private val mondayMorning: ZonedDateTime =
        ZonedDateTime.of(LocalDate.of(2026, 5, 4), LocalTime.of(10, 30), jkt)

    @Test
    fun `no rules returns fallback`() {
        val picked = ScheduleResolver.resolve(
            device = device,
            rules = emptyList(),
            nowLocal = mondayMorning,
        )
        assertEquals("fallback", picked)
    }

    @Test
    fun `no rules, no fallback returns null`() {
        val picked = ScheduleResolver.resolve(
            device = device.copy(fallback_playlist_id = null),
            rules = emptyList(),
            nowLocal = mondayMorning,
        )
        assertNull(picked)
    }

    @Test
    fun `group-targeted rule in payload beats fallback (server pre-filtered by scope)`() {
        val picked = ScheduleResolver.resolve(
            device = device,
            rules = listOf(
                RuleDto(
                    id = "r-1",
                    playlist_id = "p-morning",
                    target_device_group_id = "g-1",
                    days_of_week = listOf(1, 2, 3, 4, 5),
                    start_time = "09:00:00",
                    end_time = "12:00:00",
                    effective_at = "2026-04-01T00:00:00Z",
                ),
            ),
            nowLocal = mondayMorning,
        )
        assertEquals("p-morning", picked)
    }

    @Test
    fun `device-specific rule beats group rule even when newer group rule exists`() {
        val picked = ScheduleResolver.resolve(
            device = device,
            rules = listOf(
                RuleDto(
                    id = "r-group",
                    playlist_id = "p-group",
                    target_device_group_id = "g-1",
                    days_of_week = listOf(1),
                    start_time = "09:00:00", end_time = "12:00:00",
                    effective_at = "2026-04-22T00:00:00Z",    // newer
                ),
                RuleDto(
                    id = "r-dev",
                    playlist_id = "p-device",
                    target_device_id = "dev-1",
                    days_of_week = listOf(1),
                    start_time = "09:00:00", end_time = "12:00:00",
                    effective_at = "2026-04-01T00:00:00Z",    // older
                ),
            ),
            nowLocal = mondayMorning,
        )
        assertEquals("p-device", picked)
    }

    @Test
    fun `within a scope the newer effective_at wins`() {
        val picked = ScheduleResolver.resolve(
            device = device,
            rules = listOf(
                RuleDto(
                    id = "r-old",
                    playlist_id = "p-old",
                    target_device_group_id = "g-1",
                    days_of_week = listOf(1),
                    start_time = "09:00:00", end_time = "12:00:00",
                    effective_at = "2026-04-01T00:00:00Z",
                ),
                RuleDto(
                    id = "r-new",
                    playlist_id = "p-new",
                    target_device_group_id = "g-1",
                    days_of_week = listOf(1),
                    start_time = "09:00:00", end_time = "12:00:00",
                    effective_at = "2026-04-15T00:00:00Z",
                ),
            ),
            nowLocal = mondayMorning,
        )
        assertEquals("p-new", picked)
    }

    @Test
    fun `weekday outside days_of_week is skipped`() {
        val sunday = ZonedDateTime.of(LocalDate.of(2026, 5, 3), LocalTime.of(10, 30), jkt)
        val picked = ScheduleResolver.resolve(
            device = device,
            rules = listOf(
                RuleDto(
                    id = "r",
                    playlist_id = "p-weekday-only",
                    target_device_id = "dev-1",
                    days_of_week = listOf(1, 2, 3, 4, 5),
                    start_time = "09:00:00", end_time = "12:00:00",
                    effective_at = "2026-04-01T00:00:00Z",
                ),
            ),
            nowLocal = sunday,
        )
        assertEquals("fallback", picked)
    }

    @Test
    fun `time outside start_time and end_time is skipped`() {
        val picked = ScheduleResolver.resolve(
            device = device,
            rules = listOf(
                RuleDto(
                    id = "r",
                    playlist_id = "p-after-hours",
                    target_device_id = "dev-1",
                    days_of_week = listOf(1),
                    start_time = "18:00:00",
                    end_time = "22:00:00",
                    effective_at = "2026-04-01T00:00:00Z",
                ),
            ),
            nowLocal = mondayMorning,
        )
        assertEquals("fallback", picked)
    }
}
```

- [ ] **Step 2: Run — expect RED**

- [ ] **Step 3: Implement `ScheduleResolver.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/schedule/ScheduleResolver.kt
package com.ouie.signage.schedule

import com.ouie.signage.config.DeviceDto
import com.ouie.signage.config.RuleDto
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalTime
import java.time.ZonedDateTime

/**
 * Pure implementation of the precedence rules from spec §4. The server has
 * already filtered out (a) rules whose `effective_at` is in the future AND
 * (b) rules whose scope doesn't apply to this device (`target_device_id = me
 * OR target_device_group_id IN my_groups`). The device only needs to evaluate
 * weekday + time-of-day and apply the device-beats-group + newer-wins
 * precedence for the remaining rules.
 *
 * Precedence (highest first):
 *   1. Rules targeting this device directly (target_device_id != null)
 *   2. Rules targeting one of this device's groups (target_device_group_id != null)
 *   Within each class, rules with a later `effective_at` win (tiebreaker: id asc).
 *
 * Fallback: device.fallback_playlist_id (may be null).
 */
object ScheduleResolver {

    fun resolve(
        device: DeviceDto,
        rules: List<RuleDto>,
        nowLocal: ZonedDateTime,
    ): String? {
        val weekdayIso = nowLocal.dayOfWeek.value   // 1=Mon..7=Sun, matches spec
        val timeOfDay = nowLocal.toLocalTime()

        val applicable = rules
            .asSequence()
            .filter { weekdayIso in it.days_of_week }
            .filter { matchesTimeOfDay(it, timeOfDay) }
            .toList()

        if (applicable.isEmpty()) return device.fallback_playlist_id

        val ranked = applicable.sortedWith(
            compareByDescending<RuleDto> { it.target_device_id != null }
                .thenByDescending { Instant.parse(it.effective_at) }
                .thenBy { it.id },
        )
        return ranked.first().playlist_id
    }

    private fun matchesTimeOfDay(r: RuleDto, now: LocalTime): Boolean {
        // Postgres "time" serializes as HH:MM:SS; LocalTime.parse handles that.
        val start = LocalTime.parse(r.start_time)
        val end = LocalTime.parse(r.end_time)
        // Inclusive start, inclusive end — matches the way operators author rules
        // ("9:00 to 12:00" means 9:00–12:00 inclusive). Picking inclusive on both
        // ends does cause a 1-second overlap if two rules butt against each other
        // (e.g., 09-12 vs 12-18); precedence by effective_at breaks the tie.
        return !now.isBefore(start) && !now.isAfter(end)
    }

    /** Map ISO day-of-week (1=Mon..7=Sun) to `DayOfWeek` for callers that want it. */
    fun isoWeekdayToEnum(iso: Int): DayOfWeek = DayOfWeek.of(iso)
}
```

- [ ] **Step 4: Run — expect GREEN (6 passed)**

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/schedule/ScheduleResolver.kt \
        android-tv/app/src/test/java/com/ouie/signage/schedule/ScheduleResolverTest.kt
git commit -m "feat(android): ScheduleResolver — spec §4 precedence, device beats group, newer wins"
```

---

# Phase 4 — Heartbeat

Goal: every 60 s, POST a fresh heartbeat payload to `devices-heartbeat`. This is the first time the authed OkHttp client actually sends a request — the moment where Plan 3a's `TokenAuthenticator` wiring is validated in anger.

### Task 4.1 — `HeartbeatApi.kt`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/net/HeartbeatApi.kt`

- [ ] **Step 1: Write `HeartbeatApi.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/net/HeartbeatApi.kt
package com.ouie.signage.net

import com.ouie.signage.heartbeat.HeartbeatPayload
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

interface HeartbeatApi {
    /**
     * POST `/devices-heartbeat`. Server returns 204 on success. We keep Response<Unit>
     * rather than a suspend Unit so callers can inspect `.code()` if we ever want
     * to differentiate 204 from rare 400 responses without exception handling.
     */
    @POST("devices-heartbeat")
    suspend fun post(@Body body: HeartbeatPayload): Response<Unit>
}
```

- [ ] **Step 2: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/net/HeartbeatApi.kt
git commit -m "feat(android): HeartbeatApi — Retrofit interface for devices-heartbeat POST"
```

### Task 4.2 — `HeartbeatPayload.kt` (serializable builder)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatPayload.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/heartbeat/HeartbeatPayloadTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/heartbeat/HeartbeatPayloadTest.kt
package com.ouie.signage.heartbeat

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HeartbeatPayloadTest {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Test
    fun `full payload serializes exactly the keys the server expects`() {
        val p = HeartbeatPayload(
            app_version = "0.2.0-3b",
            uptime_seconds = 123L,
            current_playlist_id = "pl-1",
            last_config_version_applied = "sha256:abc",
            clock_skew_seconds_from_server = 3,
            cache_storage_info = CacheStorageInfo(
                root = "external",
                filesystem = "unknown",
                total_bytes = 17_179_869_184L,
                free_bytes = 12_884_901_888L,
                updated_at = "2026-04-23T10:00:00Z",
                degraded = false,
            ),
        )
        val encoded = json.encodeToString(HeartbeatPayload.serializer(), p)
        val parsed = json.parseToJsonElement(encoded) as JsonObject
        assertEquals("0.2.0-3b", parsed["app_version"]!!.jsonPrimitive.content)
        assertEquals("pl-1", parsed["current_playlist_id"]!!.jsonPrimitive.content)
        assertEquals("sha256:abc", parsed["last_config_version_applied"]!!.jsonPrimitive.content)
        assertEquals(3, parsed["clock_skew_seconds_from_server"]!!.jsonPrimitive.content.toInt())
        val cache = parsed["cache_storage_info"] as JsonObject
        assertEquals("external", cache["root"]!!.jsonPrimitive.content)
        assertEquals(17_179_869_184L, cache["total_bytes"]!!.jsonPrimitive.content.toLong())
    }

    @Test
    fun `null playlist and null skew are omitted from the JSON`() {
        val p = HeartbeatPayload(
            app_version = "0.2.0-3b",
            uptime_seconds = 1L,
            current_playlist_id = null,
            last_config_version_applied = null,
            clock_skew_seconds_from_server = null,
            cache_storage_info = null,
        )
        val encoded = json.encodeToString(HeartbeatPayload.serializer(), p)
        val parsed = json.parseToJsonElement(encoded) as JsonObject
        // kotlinx.serialization treats `null` on a nullable property as `"key":null`
        // by default; we set `explicitNulls = false` in the Json config to match the
        // server's optional-field contract. Confirm both that the key is missing OR null:
        assertEquals(true, !parsed.containsKey("current_playlist_id") || parsed["current_playlist_id"]!!.toString() == "null")
        assertEquals(true, !parsed.containsKey("cache_storage_info") || parsed["cache_storage_info"]!!.toString() == "null")
        // Uptime must always be present.
        assertEquals(1, parsed["uptime_seconds"]!!.jsonPrimitive.content.toInt())
        // (No assertion on keys we don't care about; the server ignores unknown keys.)
    }
}
```

- [ ] **Step 2: Run — expect RED**

- [ ] **Step 3: Implement `HeartbeatPayload.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatPayload.kt
package com.ouie.signage.heartbeat

import kotlinx.serialization.Serializable

/**
 * Shape exactly matches spec §8 and `supabase/functions/devices-heartbeat/index.ts`
 * (which accepts these fields and silently ignores unknown ones). `snake_case`
 * wire format throughout.
 *
 * `errors_since_last_heartbeat` from the spec is omitted in 3b — we don't yet
 * have a local error bus worth reporting. Revisit in 3c when playback errors
 * and FCM delivery events become worth surfacing.
 */
@Serializable
data class HeartbeatPayload(
    val app_version: String,
    val uptime_seconds: Long,
    val current_playlist_id: String? = null,
    val last_config_version_applied: String? = null,
    val clock_skew_seconds_from_server: Int? = null,
    val cache_storage_info: CacheStorageInfo? = null,
)

@Serializable
data class CacheStorageInfo(
    /** "internal" | "external" — matches spec §4 JSONB shape */
    val root: String,
    /** "ext4" | "exfat" | "fat32" | "unknown" — v1 reports "unknown" */
    val filesystem: String,
    val total_bytes: Long,
    val free_bytes: Long,
    /** ISO-8601 UTC */
    val updated_at: String,
    /** True when we fell back to internal because no viable external was found. */
    val degraded: Boolean = false,
)
```

- [ ] **Step 4: Run — expect GREEN (2 passed)**

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatPayload.kt \
        android-tv/app/src/test/java/com/ouie/signage/heartbeat/HeartbeatPayloadTest.kt
git commit -m "feat(android): HeartbeatPayload + CacheStorageInfo — serialization matches spec §8"
```

### Task 4.3 — `ClockSkewTracker.kt` (parse server Date header)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/heartbeat/ClockSkewTracker.kt`
- Create: `android-tv/app/src/main/java/com/ouie/signage/net/DateHeaderInterceptor.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/heartbeat/ClockSkewTrackerTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/heartbeat/ClockSkewTrackerTest.kt
package com.ouie.signage.heartbeat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class ClockSkewTrackerTest {

    // Pin "device now" to a known instant so we can test deterministic skew
    private val deviceNow = Instant.parse("2026-04-23T10:00:00Z")
    private val fixedClock = Clock.fixed(deviceNow, ZoneOffset.UTC)

    @Test
    fun `server ahead by 5 seconds yields skew=-5 on device`() {
        val tracker = ClockSkewTracker(fixedClock)
        // RFC 1123 format — what HTTP Date headers look like
        tracker.record("Thu, 23 Apr 2026 10:00:05 GMT")
        // Convention: skew is (server - device). Positive = server ahead.
        assertEquals(5, tracker.current())
    }

    @Test
    fun `server behind by 3 seconds yields skew=-3`() {
        val tracker = ClockSkewTracker(fixedClock)
        tracker.record("Thu, 23 Apr 2026 09:59:57 GMT")
        assertEquals(-3, tracker.current())
    }

    @Test
    fun `no record yields null until first observation`() {
        val tracker = ClockSkewTracker(fixedClock)
        assertNull(tracker.current())
    }

    @Test
    fun `malformed date does not throw and does not overwrite prior value`() {
        val tracker = ClockSkewTracker(fixedClock)
        tracker.record("Thu, 23 Apr 2026 10:00:05 GMT")
        tracker.record("not a date")
        assertEquals(5, tracker.current())
    }
}
```

- [ ] **Step 2: Run — expect RED**

- [ ] **Step 3: Implement `ClockSkewTracker.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/heartbeat/ClockSkewTracker.kt
package com.ouie.signage.heartbeat

import java.time.Clock
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/**
 * Per-process singleton. Every HTTP response flows through
 * `DateHeaderInterceptor`, which hands the `Date:` header to `record()`.
 * `current()` returns (server-time − device-time) in seconds — positive means
 * the server is ahead of us. `HeartbeatScheduler` reads this on every tick.
 *
 * Skipping Prometheus / running averages is intentional: we only need the most
 * recent observation so the dashboard sees fresh data, and if the device clock
 * jumps we want the next heartbeat to reflect the jump immediately.
 */
class ClockSkewTracker(private val clock: Clock = Clock.systemUTC()) {

    @Volatile private var lastSkewSeconds: Int? = null

    fun record(rfc1123Date: String) {
        try {
            val serverInstant = ZonedDateTime
                .parse(rfc1123Date, DateTimeFormatter.RFC_1123_DATE_TIME)
                .toInstant()
            val deviceInstant = clock.instant()
            lastSkewSeconds = (serverInstant.epochSecond - deviceInstant.epochSecond).toInt()
        } catch (_: Throwable) {
            // Parse failure — keep the previous value.
        }
    }

    fun current(): Int? = lastSkewSeconds
}
```

- [ ] **Step 4: Run — expect GREEN (4 passed)**

- [ ] **Step 5: Write `DateHeaderInterceptor.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/net/DateHeaderInterceptor.kt
package com.ouie.signage.net

import com.ouie.signage.heartbeat.ClockSkewTracker
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Feeds the ClockSkewTracker on every response. Installed on the `named("authed")`
 * client only; pairing traffic is pre-auth and not worth timing.
 */
class DateHeaderInterceptor(private val tracker: ClockSkewTracker) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val resp = chain.proceed(chain.request())
        resp.header("Date")?.let { tracker.record(it) }
        return resp
    }
}
```

- [ ] **Step 6: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/heartbeat/ClockSkewTracker.kt \
        android-tv/app/src/main/java/com/ouie/signage/net/DateHeaderInterceptor.kt \
        android-tv/app/src/test/java/com/ouie/signage/heartbeat/ClockSkewTrackerTest.kt
git commit -m "feat(android): ClockSkewTracker + DateHeaderInterceptor — record server-device skew"
```

### Task 4.4 — `CacheStorageInfoBuilder.kt`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/heartbeat/CacheStorageInfoBuilder.kt`

Fills the `CacheStorageInfo` payload from the current `CacheRootResolver.Pick`. `filesystem` is hard-coded to "unknown" in 3b — detecting FAT/exFAT/ext4 requires either root or hacks that aren't justified at v1 scale.

- [ ] **Step 1: Write `CacheStorageInfoBuilder.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/heartbeat/CacheStorageInfoBuilder.kt
package com.ouie.signage.heartbeat

import android.os.StatFs
import com.ouie.signage.cache.CacheRootResolver
import java.time.Instant

object CacheStorageInfoBuilder {
    fun buildFrom(pick: CacheRootResolver.Pick): CacheStorageInfo {
        // StatFs reads live values each time; the resolver's `freeBytes` is only
        // a snapshot from selection time. Refresh here so the dashboard shows
        // accurate numbers.
        val stats = try { StatFs(pick.root.absolutePath) } catch (_: Throwable) { null }
        val totalBytes = stats?.let { it.blockCountLong * it.blockSizeLong } ?: 0L
        val freeBytes  = stats?.let { it.availableBlocksLong * it.blockSizeLong } ?: pick.freeBytes

        return CacheStorageInfo(
            root = if (pick.kind == CacheRootResolver.Kind.External) "external" else "internal",
            filesystem = "unknown",   // 3b limitation; revisit in 3c when USB detection matters
            total_bytes = totalBytes,
            free_bytes = freeBytes,
            updated_at = Instant.now().toString(),
            degraded = pick.degraded,
        )
    }
}
```

- [ ] **Step 2: Build verification**

```bash
cd android-tv && ./gradlew :app:assembleDebug
```

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/heartbeat/CacheStorageInfoBuilder.kt
git commit -m "feat(android): CacheStorageInfoBuilder — StatFs-backed cache_storage_info payload"
```

### Task 4.5 — `HeartbeatScheduler.kt` (60 s loop)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt`

`HeartbeatScheduler` composes:
- `HeartbeatApi` for the POST
- `CacheManager` for the cache_storage_info
- `PlaybackDirector` (created later in Phase 6) for the `current_playlist_id`
- `ConfigRepository` for the `last_config_version_applied`
- `ClockSkewTracker` for the skew
- process `ElapsedRealtime` for the uptime

Since PlaybackDirector isn't yet written, we declare a tiny `CurrentPlaylistSource` interface now and wire `PlaybackDirector` to implement it in Phase 6.

- [ ] **Step 1: Write `HeartbeatScheduler.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt
package com.ouie.signage.heartbeat

import android.os.SystemClock
import com.ouie.signage.BuildConfig
import com.ouie.signage.cache.CacheRootResolver
import com.ouie.signage.config.ConfigRepository
import com.ouie.signage.net.HeartbeatApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Lightweight contract letting the heartbeat ask "what's currently being
 * played?" without depending on the full PlaybackDirector class. PlaybackDirector
 * implements this in Phase 6.
 */
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
        val payload = HeartbeatPayload(
            app_version = BuildConfig.VERSION_NAME,
            uptime_seconds = uptimeSeconds,
            current_playlist_id = playlistSource.current(),
            last_config_version_applied = configRepo.current.value?.version,
            clock_skew_seconds_from_server = skewTracker.current(),
            cache_storage_info = pick?.let { CacheStorageInfoBuilder.buildFrom(it) },
        )
        try {
            api.post(payload)    // 401 → TokenAuthenticator refresh & retry
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            // Best-effort; next tick tries again.
        }
    }
}
```

- [ ] **Step 2: Build verification (no unit test — the non-pure I/O and Android deps make a JVM test too much plumbing for too little signal; the payload builder itself is tested)**

```bash
cd android-tv && ./gradlew :app:assembleDebug
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt
git commit -m "feat(android): HeartbeatScheduler — 60s loop posting payload + CurrentPlaylistSource fn iface"
```

---

# Phase 5 — Media downloader + cache-status reporter

Goal: given a list of media that should be cached but isn't, stream each file from its signed URL into `<cache>/media/<id>.<ext>`, verify sha256, atomic-rename, update `MediaCacheIndex`, and POST a `cache_events` batch so the dashboard can show it.

### Task 5.1 — `MediaDownloader.kt` (one media → cached or failed)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/sync/MediaDownloader.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/sync/MediaDownloaderTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/sync/MediaDownloaderTest.kt
package com.ouie.signage.sync

import com.ouie.signage.cache.CacheLayout
import com.ouie.signage.cache.Checksum
import com.ouie.signage.config.MediaDto
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class MediaDownloaderTest {

    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer

    @Before fun setUp()    { server = MockWebServer().apply { start() } }
    @After  fun tearDown() { server.shutdown() }

    private fun layout(): CacheLayout {
        val root = tmp.newFolder()
        File(root, "media").mkdirs()
        return CacheLayout(root)
    }

    @Test
    fun `happy path — writes file and returns Success with checksum`() = runBlocking {
        val body = "hello world"
        // shasum -a 256 of "hello world":
        val expected = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        server.enqueue(MockResponse().setBody(Buffer().writeUtf8(body)))

        val dl = MediaDownloader(OkHttpClient(), layout())
        val result = dl.download(
            MediaDto(
                id = "m1", kind = "video", size_bytes = body.length.toLong(),
                checksum = expected,
                url = server.url("/file.mp4").toString(),
            ),
            expectedExt = "mp4",
        )
        assertEquals(MediaDownloader.Result.Success, result)
        val file = dl.layout.mediaFile("m1", "mp4")
        assertTrue(file.exists())
        assertEquals(expected, Checksum.sha256OfFile(file))
    }

    @Test
    fun `checksum mismatch deletes partial and returns ChecksumMismatch`() = runBlocking {
        server.enqueue(MockResponse().setBody("hello world"))
        val dl = MediaDownloader(OkHttpClient(), layout())
        val result = dl.download(
            MediaDto(
                id = "m1", kind = "video", size_bytes = 11,
                checksum = "0".repeat(64),          // intentionally wrong
                url = server.url("/bad.mp4").toString(),
            ),
            expectedExt = "mp4",
        )
        assertEquals(true, result is MediaDownloader.Result.ChecksumMismatch)
        assertFalse(dl.layout.mediaFile("m1", "mp4").exists())
        assertFalse(dl.layout.tempFile("m1", "mp4").exists())
    }

    @Test
    fun `5xx returns NetworkError`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503))
        val dl = MediaDownloader(OkHttpClient(), layout())
        val result = dl.download(
            MediaDto(
                id = "m1", kind = "video", size_bytes = 1,
                checksum = "0".repeat(64),
                url = server.url("/fail").toString(),
            ),
            expectedExt = "mp4",
        )
        assertEquals(true, result is MediaDownloader.Result.NetworkError)
    }
}
```

- [ ] **Step 2: Run — expect RED**

- [ ] **Step 3: Implement `MediaDownloader.kt`**

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

/**
 * Downloads one media blob to disk with sha256 verification. Operates on the
 * shared OkHttp — any 401 path is handled by TokenAuthenticator (not that R2
 * signed URLs return 401; they return 403 on invalidation, so we treat both
 * 4xx and 5xx as NetworkError).
 *
 * Flow:
 *   1. GET url, stream response body to <cache>/media/<id>.<ext>.part
 *   2. sha256 the temp file
 *   3. On match: atomic-rename to <cache>/media/<id>.<ext>, return Success
 *   4. On mismatch: delete temp, return ChecksumMismatch
 *
 * The coroutine runs network+disk I/O on Dispatchers.IO. Caller (MediaSyncWorker)
 * is expected to serialize calls — spec §6.2 mandates one download at a time so
 * we don't thrash weak WiFi.
 */
class MediaDownloader(
    private val httpClient: OkHttpClient,
    val layout: CacheLayout,
) {

    sealed interface Result {
        data object Success : Result
        data class ChecksumMismatch(val expected: String, val actual: String) : Result
        data class NetworkError(val code: Int?, val cause: Throwable?) : Result
    }

    suspend fun download(media: MediaDto, expectedExt: String): Result = withContext(Dispatchers.IO) {
        layout.mediaDir().mkdirs()
        val temp = layout.tempFile(media.id, expectedExt)
        val dest = layout.mediaFile(media.id, expectedExt)

        // Clean up any stale partial from a previous attempt.
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
                    temp.outputStream().use { output ->
                        input.copyTo(output, bufferSize = 64 * 1024)
                    }
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

        // Atomic rename within the same directory = same-volume move.
        if (dest.exists()) dest.delete()
        if (!temp.renameTo(dest)) {
            // Extremely rare — fall back to copy + delete.
            temp.copyTo(dest, overwrite = true)
            temp.delete()
        }
        Result.Success
    }
}
```

- [ ] **Step 4: Run — expect GREEN (3 passed)**

```bash
cd android-tv && ./gradlew :app:testDebugUnitTest --tests "com.ouie.signage.sync.MediaDownloaderTest"
```

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/sync/MediaDownloader.kt \
        android-tv/app/src/test/java/com/ouie/signage/sync/MediaDownloaderTest.kt
git commit -m "feat(android): MediaDownloader — stream-to-temp, sha256-verify, atomic rename"
```

### Task 5.2 — `CacheStatusApi.kt` + `CacheStatusReporter.kt`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/net/CacheStatusApi.kt`
- Create: `android-tv/app/src/main/java/com/ouie/signage/sync/CacheStatusReporter.kt`

- [ ] **Step 1: Write `CacheStatusApi.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/net/CacheStatusApi.kt
package com.ouie.signage.net

import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

interface CacheStatusApi {
    @POST("devices-cache-status")
    suspend fun post(@Body body: CacheStatusBatch): Response<Unit>
}

@Serializable
data class CacheStatusBatch(val events: List<CacheStatusEvent>)

@Serializable
data class CacheStatusEvent(
    /** "cached" | "failed" | "evicted" | "preloaded" — spec §4 `cache_events.state` CHECK */
    val state: String,
    val media_id: String? = null,
    val message: String? = null,
)
```

- [ ] **Step 2: Write `CacheStatusReporter.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/sync/CacheStatusReporter.kt
package com.ouie.signage.sync

import com.ouie.signage.net.CacheStatusApi
import com.ouie.signage.net.CacheStatusBatch
import com.ouie.signage.net.CacheStatusEvent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Batches cache events, flushes to devices-cache-status either when the queue
 * has `maxBatchSize` events or every `flushIntervalMs`. The coroutine is tied
 * to the Coordinator's scope.
 *
 * Non-retrying on purpose: cache events are diagnostic, not billable. If a
 * batch fails to upload, next batch carries the fresh events; the missing
 * ones are logged locally via the debug HTTP interceptor.
 */
class CacheStatusReporter(
    private val scope: CoroutineScope,
    private val api: CacheStatusApi,
    private val flushIntervalMs: Long = 10_000,
    private val maxBatchSize: Int = 20,
) {

    private val inbox = Channel<CacheStatusEvent>(capacity = 128)
    private var job: Job? = null

    fun start() {
        if (job?.isActive == true) return
        job = scope.launch {
            val pending = mutableListOf<CacheStatusEvent>()
            var lastFlush = System.currentTimeMillis()
            while (isActive) {
                // Drain whatever's queued without blocking
                while (true) {
                    val item = inbox.tryReceive().getOrNull() ?: break
                    pending += item
                }
                val shouldFlushBySize = pending.size >= maxBatchSize
                val shouldFlushByTime = pending.isNotEmpty() &&
                    System.currentTimeMillis() - lastFlush >= flushIntervalMs
                if (shouldFlushBySize || shouldFlushByTime) {
                    val batch = pending.toList()
                    pending.clear()
                    try {
                        api.post(CacheStatusBatch(batch))
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Throwable) {
                        // Drop; next batch will include new events.
                    }
                    lastFlush = System.currentTimeMillis()
                }
                try { delay(500) } catch (e: CancellationException) { throw e }
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    fun report(event: CacheStatusEvent) {
        // `trySend` drops when the channel is full — we don't care; events are
        // informational only.
        inbox.trySend(event)
    }

    fun cached(mediaId: String)          = report(CacheStatusEvent(state = "cached",   media_id = mediaId))
    fun failed(mediaId: String, msg: String) = report(CacheStatusEvent(state = "failed", media_id = mediaId, message = msg))
}
```

- [ ] **Step 3: Build verification**

```bash
cd android-tv && ./gradlew :app:assembleDebug
```

- [ ] **Step 4: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/net/CacheStatusApi.kt \
        android-tv/app/src/main/java/com/ouie/signage/sync/CacheStatusReporter.kt
git commit -m "feat(android): CacheStatusApi + CacheStatusReporter — batched events to devices-cache-status"
```

### Task 5.3 — `MediaSyncWorker.kt` (the download queue)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/sync/MediaSyncWorker.kt`

`MediaSyncWorker` watches `ConfigRepository.current` + `CacheManager.cached` and computes the set `needed = referenced media − cached`. When `needed` is non-empty it walks the queue serially, downloading each file. It is **the** path for new-media acquisition in 3b — the spec-mandated sync window is respected only for "big playlist rotation at 03:00" scenarios, which aren't exercised in 3b. We always eagerly sync when the playback director reports "desired playlist not cached", matching the spec §6.3 cache-before-switch trigger.

- [ ] **Step 1: Write `MediaSyncWorker.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/sync/MediaSyncWorker.kt
package com.ouie.signage.sync

import com.ouie.signage.cache.CacheLayout
import com.ouie.signage.cache.CacheManager
import com.ouie.signage.cache.MediaCacheIndex
import com.ouie.signage.config.ConfigDto
import com.ouie.signage.config.ConfigRepository
import com.ouie.signage.config.MediaDto
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Serial download queue. Reads the current config + the cached set, downloads
 * anything missing one at a time, and writes the MediaCacheIndex row on success.
 * When a download fails, emits a cache_event with state=failed and backs off
 * before the next attempt.
 *
 * Triggers:
 *   - ConfigRepository.current emits a new version
 *   - CacheManager.cached changes (e.g., file disappeared)
 *
 * In 3b there is no explicit "sync window" gate: we always sync. This is safe
 * for v1's 8-device scale and matches spec §6.3's cache-before-switch
 * expectation that playback will re-trigger a sync if desired isn't cached.
 * Sync-window gating is deferred to v1.1 operational tuning.
 */
class MediaSyncWorker(
    private val scope: CoroutineScope,
    private val configRepo: ConfigRepository,
    private val cache: CacheManager,
    private val downloader: MediaDownloader,
    private val reporter: CacheStatusReporter,
    private val index: MediaCacheIndex,
) {

    private var job: Job? = null

    fun start() {
        if (job?.isActive == true) return
        job = scope.launch {
            // React to new configs AND to cache deletions. collectLatest cancels
            // the in-flight download loop when a newer signal arrives, which is
            // desirable — the newer config may no longer need that media.
            configRepo.current.collectLatest { cfg ->
                if (cfg == null) return@collectLatest
                syncAllMissing(cfg)
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    private suspend fun syncAllMissing(cfg: ConfigDto) {
        val referenced = cfg.playlists.flatMap { pl -> pl.items.map { it.media_id } }.toSet()
        val cachedNow = cache.cached.value
        val missing = cfg.media.filter { it.id in referenced && it.id !in cachedNow }

        for (media in missing) {
            if (!isActive) return
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
                        cachedAtEpochSeconds = Instant.now().epochSecond,
                        lastPlayedAtEpochSeconds = null,
                    ),
                )
                reporter.cached(media.id)
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
}
```

- [ ] **Step 2: Build verification**

```bash
cd android-tv && ./gradlew :app:assembleDebug
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/sync/MediaSyncWorker.kt
git commit -m "feat(android): MediaSyncWorker — serial download queue, reacts to config + cache changes"
```

---

# Phase 6 — Playback

Goal: resolve the active playlist every second, switch only when the new playlist is fully cached, and play video/image items through ExoPlayer / Compose Image.

### Task 6.1 — `PlaybackItem.kt` + `PlaybackState.kt`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackItem.kt`
- Create: `android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackState.kt`

- [ ] **Step 1: Write `PlaybackItem.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackItem.kt
package com.ouie.signage.playback

import java.io.File

/**
 * Normalised playback unit — what the screen actually renders. Derived from
 * PlaylistItemDto + MediaDto + CacheManager.fileFor(). Not wire-serialized;
 * lives in-memory only.
 */
data class PlaybackItem(
    val mediaId: String,
    val kind: Kind,
    val localFile: File,
    val durationSeconds: Double,  // for images: the operator-set duration.
                                  // for videos: defaults to video_duration_seconds or 0 (ExoPlayer drives).
) {
    enum class Kind { Video, Image }
}
```

- [ ] **Step 2: Write `PlaybackState.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackState.kt
package com.ouie.signage.playback

sealed interface PlaybackState {
    /** No rule matches and no fallback — show "No content configured". */
    data object NoContent : PlaybackState

    /**
     * A playlist is desired but not fully cached yet. We're either starting fresh
     * or a schedule just flipped. Show "Preparing content…" to avoid a customer-
     * facing error. Spec §6.3: never interrupt an already-playing cached playlist
     * for this.
     */
    data object Preparing : PlaybackState

    /** Playing an item from a cached playlist. */
    data class Playing(
        val playlistId: String,
        val index: Int,
        val item: PlaybackItem,
    ) : PlaybackState
}
```

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackItem.kt \
        android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackState.kt
git commit -m "feat(android): PlaybackItem + PlaybackState — normalised renderables + sealed UI state"
```

### Task 6.2 — `PlaybackDirector.kt` (the 1 Hz ticker)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackDirector.kt`
- Create: `android-tv/app/src/test/java/com/ouie/signage/playback/PlaybackDirectorTest.kt`

`PlaybackDirector` is the only non-pure module in this phase but the scheduling/selection logic is worth pure-testing. The unit test covers: (a) no rules + no fallback → NoContent, (b) desired fully cached → Playing(first_item), (c) desired not cached, current exists → keep current, (d) desired not cached, no current → Preparing.

- [ ] **Step 1: Write the failing test**

```kotlin
// android-tv/app/src/test/java/com/ouie/signage/playback/PlaybackDirectorTest.kt
package com.ouie.signage.playback

import com.ouie.signage.config.ConfigDto
import com.ouie.signage.config.DeviceDto
import com.ouie.signage.config.MediaDto
import com.ouie.signage.config.PlaylistDto
import com.ouie.signage.config.PlaylistItemDto
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.io.File

@OptIn(ExperimentalCoroutinesApi::class)
class PlaybackDirectorTest {

    private fun cfg(vararg mediaIds: String): ConfigDto = ConfigDto(
        version = "v1",
        device = DeviceDto("dev-1", "store-1", fallback_playlist_id = "pl", timezone = "UTC"),
        playlists = listOf(
            PlaylistDto(
                id = "pl", name = "p", updated_at = "2026-04-01T00:00:00Z",
                items = mediaIds.mapIndexed { i, id ->
                    PlaylistItemDto(media_id = id, position = i + 1, duration_seconds = 5.0)
                },
            ),
        ),
        media = mediaIds.map {
            MediaDto(id = it, kind = "image", size_bytes = 0, checksum = "", url = "/$it.jpg")
        },
    )

    private fun director(
        cfg: ConfigDto?,
        cached: Set<String> = emptySet(),
        fileExists: Boolean = true,
    ): PlaybackDirector {
        // Use a real temp file so `File.exists()` returns true for cached items.
        // Tests that want "file missing" pass fileExists=false and we return a
        // non-existent path instead.
        val tmpFile = if (fileExists) {
            File.createTempFile("playback-test", ".bin").apply { deleteOnExit() }
        } else {
            File("/does/not/exist.bin")
        }
        return PlaybackDirector(
            config = MutableStateFlow(cfg),
            cachedMediaIds = MutableStateFlow(cached),
            fileFor = { _ -> tmpFile },
            clock = Clock.fixed(Instant.parse("2026-04-23T10:00:00Z"), ZoneOffset.UTC),
        )
    }

    @Test
    fun `null config emits NoContent`() = runTest {
        val d = director(cfg = null)
        d.tick()
        assertEquals(PlaybackState.NoContent, d.state.first())
    }

    @Test
    fun `config with fallback + nothing cached emits Preparing`() = runTest {
        val d = director(cfg = cfg("m1", "m2"), cached = emptySet())
        d.tick()
        assertEquals(PlaybackState.Preparing, d.state.first())
    }

    @Test
    fun `desired fully cached emits Playing starting at index 0`() = runTest {
        val d = director(cfg = cfg("m1", "m2"), cached = setOf("m1", "m2"))
        d.tick()
        val state = d.state.first() as PlaybackState.Playing
        assertEquals("pl", state.playlistId)
        assertEquals(0, state.index)
        assertEquals("m1", state.item.mediaId)
    }

    @Test
    fun `advance moves to next item then loops`() = runTest {
        val d = director(cfg = cfg("m1", "m2"), cached = setOf("m1", "m2"))
        d.tick()
        d.advanceItem()
        assertEquals(1, (d.state.first() as PlaybackState.Playing).index)
        d.advanceItem()
        // Loop back to 0
        assertEquals(0, (d.state.first() as PlaybackState.Playing).index)
    }
}
```

- [ ] **Step 2: Run — expect RED**

- [ ] **Step 3: Implement `PlaybackDirector.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackDirector.kt
package com.ouie.signage.playback

import com.ouie.signage.config.ConfigDto
import com.ouie.signage.config.MediaDto
import com.ouie.signage.config.PlaylistDto
import com.ouie.signage.heartbeat.CurrentPlaylistSource
import com.ouie.signage.schedule.ScheduleResolver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.time.Clock
import java.time.ZoneId

/**
 * Selects the active playlist at ~1 Hz and exposes a PlaybackState StateFlow.
 * The actual item-advance (video-end, image-duration-elapsed) is driven by the
 * PlaybackScreen Compose layer calling `advanceItem()`.
 *
 * Cache-before-switch (spec §6.3): if the resolved desired playlist is not
 * fully cached AND we already have a cached current, we keep the current one
 * playing. If we have no current, we emit Preparing. The MediaSyncWorker is
 * doing the downloads in the background; as soon as the cache fills, the next
 * tick flips to Playing.
 *
 * The module is driven by flows the caller owns — config, cached media ids, group
 * memberships. No direct dependency on ConfigRepository / CacheManager, which
 * keeps this testable on the JVM.
 */
class PlaybackDirector(
    private val config: StateFlow<ConfigDto?>,
    private val cachedMediaIds: StateFlow<Set<String>>,
    private val fileFor: (mediaId: String) -> File?,
    private val clock: Clock = Clock.systemUTC(),
) : CurrentPlaylistSource {

    private val _state = MutableStateFlow<PlaybackState>(PlaybackState.NoContent)
    val state: StateFlow<PlaybackState> = _state.asStateFlow()

    /** 0-based index inside the currently-playing playlist. */
    private var currentIndex: Int = 0

    override fun current(): String? = (state.value as? PlaybackState.Playing)?.playlistId

    private var tickerJob: Job? = null

    fun startTicker(scope: CoroutineScope, intervalMs: Long = 1_000) {
        if (tickerJob?.isActive == true) return
        tickerJob = scope.launch {
            while (isActive) {
                tick()
                try { delay(intervalMs) } catch (e: CancellationException) { throw e }
            }
        }
    }

    fun stopTicker() {
        tickerJob?.cancel()
        tickerJob = null
    }

    /** Visible for unit tests. */
    fun tick() {
        val cfg = config.value
        if (cfg == null) {
            _state.value = PlaybackState.NoContent
            return
        }
        val nowLocal = java.time.ZonedDateTime.ofInstant(
            clock.instant(),
            ZoneId.of(cfg.device.timezone),
        )
        val desiredPlaylistId = ScheduleResolver.resolve(
            device = cfg.device,
            rules = cfg.rules,
            nowLocal = nowLocal,
        )
        if (desiredPlaylistId == null) {
            _state.value = PlaybackState.NoContent
            return
        }
        val playlist = cfg.playlists.firstOrNull { it.id == desiredPlaylistId }
        if (playlist == null || playlist.items.isEmpty()) {
            _state.value = PlaybackState.NoContent
            return
        }
        val cached = cachedMediaIds.value
        val allCached = playlist.items.all { it.media_id in cached }
        if (!allCached) {
            // Spec §6.3: keep playing current if it's still cached.
            val currentPlaying = _state.value as? PlaybackState.Playing
            if (currentPlaying != null &&
                currentPlaying.playlistId != desiredPlaylistId &&
                currentPlaying.item.mediaId in cached
            ) {
                // Intentionally keep the current playing — do NOT flip yet.
                return
            }
            if (currentPlaying != null && currentPlaying.playlistId == desiredPlaylistId &&
                currentPlaying.item.mediaId in cached) {
                // Still playing this playlist and current item is cached; continue.
                return
            }
            _state.value = PlaybackState.Preparing
            return
        }

        val needsSwitch = (_state.value as? PlaybackState.Playing)?.playlistId != desiredPlaylistId
        if (needsSwitch) currentIndex = 0
        currentIndex = currentIndex.coerceIn(0, playlist.items.size - 1)
        val item = buildItem(playlist, cfg.media, currentIndex) ?: run {
            // File went missing between cache flow and now — treat as not cached.
            _state.value = PlaybackState.Preparing
            return
        }
        _state.value = PlaybackState.Playing(playlist.id, currentIndex, item)
    }

    /** Called by PlaybackScreen when the current item's duration elapsed / video ended. */
    fun advanceItem() {
        val cfg = config.value ?: return
        val s = state.value as? PlaybackState.Playing ?: return
        val pl = cfg.playlists.firstOrNull { it.id == s.playlistId } ?: return
        currentIndex = (s.index + 1) % pl.items.size
        val next = buildItem(pl, cfg.media, currentIndex) ?: return
        _state.value = PlaybackState.Playing(pl.id, currentIndex, next)
    }

    private fun buildItem(pl: PlaylistDto, media: List<MediaDto>, idx: Int): PlaybackItem? {
        val pi = pl.items.getOrNull(idx) ?: return null
        val m = media.firstOrNull { it.id == pi.media_id } ?: return null
        val file = fileFor(pi.media_id) ?: return null
        if (!file.exists()) return null
        return PlaybackItem(
            mediaId = m.id,
            kind = if (m.kind == "video") PlaybackItem.Kind.Video else PlaybackItem.Kind.Image,
            localFile = file,
            durationSeconds = when {
                m.kind == "video" -> pi.duration_seconds ?: m.video_duration_seconds ?: 0.0
                else -> pi.duration_seconds ?: 5.0    // image default 5s if operator omitted
            },
        )
    }
}
```

- [ ] **Step 4: Run — expect GREEN (4 passed)**

- [ ] **Step 5: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackDirector.kt \
        android-tv/app/src/test/java/com/ouie/signage/playback/PlaybackDirectorTest.kt
git commit -m "feat(android): PlaybackDirector — 1Hz ticker + cache-before-switch + advance/loop"
```

### Task 6.3 — `NoContentScreen.kt`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/playback/NoContentScreen.kt`

- [ ] **Step 1: Write `NoContentScreen.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/playback/NoContentScreen.kt
package com.ouie.signage.playback

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text

/** Customer-visible fallback when no rule and no fallback_playlist are set. */
@Composable
fun NoContentScreen(message: String = "No content configured") {
    Box(
        Modifier.fillMaxSize().background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = message, color = Color(0xFF666666), fontSize = 22.sp)
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/playback/NoContentScreen.kt
git commit -m "feat(android): NoContentScreen — customer-safe black fallback"
```

### Task 6.4 — `VideoPlayerHost.kt` (ExoPlayer bridge)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/playback/VideoPlayerHost.kt`

- [ ] **Step 1: Write `VideoPlayerHost.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/playback/VideoPlayerHost.kt
package com.ouie.signage.playback

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import java.io.File

/**
 * Hosts an ExoPlayer + PlayerView inside Compose via AndroidView. When [file]
 * changes, replaces the media item and re-plays. When the Composition leaves,
 * releases the player.
 *
 * `onEnded` fires when the single media item finishes (we do NOT loop a single
 * video; looping happens at the playlist level via PlaybackDirector.advanceItem).
 */
@Composable
fun VideoPlayerHost(file: File, onEnded: () -> Unit) {
    val context = LocalContext.current
    val endedCallback by rememberUpdatedState(onEnded)

    val player = remember {
        ExoPlayer.Builder(context).build().apply {
            playWhenReady = true
            repeatMode = Player.REPEAT_MODE_OFF
        }
    }

    LaunchedEffect(file) {
        player.setMediaItem(MediaItem.fromUri(file.toURI().toString()))
        player.prepare()
    }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) endedCallback()
            }
        }
        player.addListener(listener)
        onDispose {
            player.removeListener(listener)
            player.release()
        }
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            PlayerView(ctx).apply {
                useController = false
                this.player = player
                setShutterBackgroundColor(android.graphics.Color.BLACK)
            }
        },
    )
}
```

- [ ] **Step 2: Build verification**

```bash
cd android-tv && ./gradlew :app:assembleDebug
```

Expected: BUILD SUCCESSFUL. (Media3 deps were already pinned in 3a's libs.versions.toml.)

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/playback/VideoPlayerHost.kt
git commit -m "feat(android): VideoPlayerHost — ExoPlayer AndroidView with onEnded callback"
```

### Task 6.5 — `ImageSlideHost.kt`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/playback/ImageSlideHost.kt`

- [ ] **Step 1: Write `ImageSlideHost.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/playback/ImageSlideHost.kt
package com.ouie.signage.playback

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import kotlinx.coroutines.delay
import java.io.File

/**
 * Renders a local image and invokes onTimeout after `durationSeconds` to trigger
 * advance. Decoding is synchronous on first composition — images are small
 * enough (< 10 MB typical for signage JPEG) that the frame hitch is acceptable.
 *
 * Uses `androidx.compose.foundation.Image` rather than Coil/Glide: we have the
 * bitmap on disk already, and pulling in Coil just for this is overkill.
 */
@Composable
fun ImageSlideHost(file: File, durationSeconds: Double, onTimeout: () -> Unit) {
    val bitmap = remember(file) { BitmapFactory.decodeFile(file.absolutePath) }
    val timeoutCallback by rememberUpdatedState(onTimeout)

    LaunchedEffect(file, durationSeconds) {
        // durationSeconds can be 0 if the config is malformed; guard against that
        // so we don't end up advancing in a tight loop.
        val ms = (durationSeconds.coerceAtLeast(1.0) * 1000).toLong()
        delay(ms)
        timeoutCallback()
    }

    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit,
            )
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/playback/ImageSlideHost.kt
git commit -m "feat(android): ImageSlideHost — Compose image renderer with per-item duration advance"
```

### Task 6.6 — `PlaybackScreen.kt` (combines all three paths)

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackScreen.kt`

- [ ] **Step 1: Write `PlaybackScreen.kt`**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackScreen.kt
package com.ouie.signage.playback

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import kotlinx.coroutines.flow.StateFlow

@Composable
fun PlaybackScreen(
    state: StateFlow<PlaybackState>,
    onAdvanceItem: () -> Unit,
) {
    val s by state.collectAsState()
    when (val cur = s) {
        PlaybackState.NoContent -> NoContentScreen()
        PlaybackState.Preparing -> PreparingScreen()
        is PlaybackState.Playing -> {
            when (cur.item.kind) {
                PlaybackItem.Kind.Video -> VideoPlayerHost(
                    file = cur.item.localFile,
                    onEnded = onAdvanceItem,
                )
                PlaybackItem.Kind.Image -> ImageSlideHost(
                    file = cur.item.localFile,
                    durationSeconds = cur.item.durationSeconds,
                    onTimeout = onAdvanceItem,
                )
            }
        }
    }
}

@Composable
private fun PreparingScreen() {
    // Spec §6.3: customer-visible transient screen during cold start or post-switch
    // while the new playlist's media is still downloading.
    Box(
        Modifier.fillMaxSize().background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = "Preparing content…", color = Color(0xFFAAAAAA), fontSize = 20.sp)
    }
}
```

- [ ] **Step 2: Build verification**

```bash
cd android-tv && ./gradlew :app:assembleDebug
```

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackScreen.kt
git commit -m "feat(android): PlaybackScreen — dispatches NoContent / Preparing / Video / Image"
```

---

# Phase 7 — Wiring it all together

Goal: `RunningCoordinator` owns the long-running loops. `RunningScreen` renders the playback flow. `MainActivity` starts/stops the coordinator when entering/leaving `AppState.Running`.

### Task 7.1 — `RunningCoordinator.kt`

**Files:**
- Create: `android-tv/app/src/main/java/com/ouie/signage/coordinator/RunningCoordinator.kt`

The coordinator is the **only** class that knows about the Android `Context` and translates it into cache-root selection + MediaCacheIndex instantiation + the full three-loop startup.

- [ ] **Step 1: Write `RunningCoordinator.kt`**

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
import com.ouie.signage.heartbeat.ClockSkewTracker
import com.ouie.signage.heartbeat.HeartbeatScheduler
import com.ouie.signage.net.CacheStatusApi
import com.ouie.signage.net.ConfigApi
import com.ouie.signage.net.HeartbeatApi
import com.ouie.signage.playback.PlaybackDirector
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
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import java.io.File

/**
 * The heart of 3b. Orchestrates:
 *   - CacheManager (rebuilt on start since cache root selection happens here)
 *   - ConfigPoller         — 60 s devices-config loop
 *   - HeartbeatScheduler   — 60 s devices-heartbeat loop
 *   - MediaSyncWorker      — reactive download queue
 *   - CacheStatusReporter  — batched devices-cache-status flush
 *   - PlaybackDirector     — 1 Hz ticker
 *
 * Lifecycle:
 *   start() — idempotent; allocates a fresh `scope`, picks the cache root,
 *             wires loops, kicks them off.
 *   stop()  — cancels the scope (stops every child coroutine).
 *
 * Called by MainActivity in response to AppState transitions.
 */
class RunningCoordinator(
    private val context: Context,
    private val authedHttpClient: OkHttpClient,
    private val configApi: ConfigApi,
    private val heartbeatApi: HeartbeatApi,
    private val cacheStatusApi: CacheStatusApi,
    private val skewTracker: ClockSkewTracker,
    private val json: Json,
) {

    private var scope: CoroutineScope? = null
    private var configPoller: ConfigPoller? = null
    private var heartbeat: HeartbeatScheduler? = null
    private var sync: MediaSyncWorker? = null
    private var reporter: CacheStatusReporter? = null

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

        val configDir = File(context.filesDir, "signage/config")
        val configStore = ConfigStore(configDir, json)
        val configRepo = ConfigRepository(configApi, configStore)

        val director = PlaybackDirector(
            config = configRepo.current,
            cachedMediaIds = cache.cached,
            fileFor = { id -> cache.fileFor(id) },
        )
        _playbackDirector.value = director

        // Rehydrate cached set from disk: ask MediaCacheIndex which media_ids are
        // known, filter to what the current config references. The config may be
        // null on a fresh install; next fetch() fills it.
        val knownIds: List<String> = configRepo.current.value?.media?.map { it.id } ?: emptyList()
        cache.rehydrate(knownIds)

        val downloader = MediaDownloader(authedHttpClient, layout)
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
        )
        heartbeat = beat
        beat.start()

        director.startTicker(newScope)
    }

    fun stop() {
        _playbackDirector.value?.stopTicker()
        _playbackDirector.value = null
        configPoller?.stop(); configPoller = null
        heartbeat?.stop();    heartbeat = null
        sync?.stop();         sync = null
        reporter?.stop();     reporter = null
        scope?.cancel()
        scope = null
        _cachePick.value = null
    }

    private fun pickCacheRoot(context: Context): CacheRootResolver.Pick {
        // Primary: getExternalFilesDirs. First element is internal "external"; others
        // are mounted externals (USB). Each entry may be null on permission issues.
        val externalDirs = context.getExternalFilesDirs(null).filterNotNull().filter { it.exists() }
        val primary = externalDirs.drop(1)   // skip the first, which is emulated-internal
        val candidates = primary.map { dir ->
            val stats = try { StatFs(dir.absolutePath) } catch (_: Throwable) { null }
            val free = stats?.let { it.availableBlocksLong * it.blockSizeLong } ?: 0L
            CacheRootResolver.Candidate(dir = File(dir, "cache"), freeBytes = free, isExternal = true)
        }
        val internalDir = File(context.filesDir, "signage/cache")
        internalDir.mkdirs()
        val internalStats = try { StatFs(internalDir.absolutePath) } catch (_: Throwable) { null }
        val internalFree = internalStats?.let { it.availableBlocksLong * it.blockSizeLong } ?: 0L

        // Also try StorageManager for additional volumes not returned by the primary call.
        // Kept conservative — skip on API errors; the primary path covers the common case.
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
cd android-tv && ./gradlew :app:assembleDebug
```

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/coordinator/RunningCoordinator.kt
git commit -m "feat(android): RunningCoordinator — lifecycle-owned heartbeat + config + sync + playback"
```

### Task 7.2 — Rewrite `RunningScreen.kt`

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/running/RunningScreen.kt`

- [ ] **Step 1: Replace the placeholder with a real player**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/running/RunningScreen.kt
package com.ouie.signage.running

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.ouie.signage.coordinator.RunningCoordinator
import com.ouie.signage.playback.PlaybackScreen
import org.koin.compose.koinInject

@Composable
fun RunningScreen(deviceId: String) {
    val coordinator: RunningCoordinator = koinInject()
    val director by coordinator.playbackDirector.collectAsState()
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        val d = director
        if (d != null) {
            PlaybackScreen(state = d.state, onAdvanceItem = { d.advanceItem() })
        }
        // While coordinator is still starting (a few hundred ms at most), keep
        // the screen black. No spinner — we never want to show loading chrome
        // to customers.
    }
}
```

- [ ] **Step 2: Build verification**

```bash
cd android-tv && ./gradlew :app:assembleDebug
```

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/running/RunningScreen.kt
git commit -m "feat(android): RunningScreen — hosts PlaybackScreen from coordinator director"
```

### Task 7.3 — Extend `AppModule.kt` with the new graph

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt`

- [ ] **Step 1: Replace the module body**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt
package com.ouie.signage.di

import com.ouie.signage.auth.TokenSource
import com.ouie.signage.auth.TokenStore
import com.ouie.signage.coordinator.RunningCoordinator
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

    // Pairing client — no auth, no skew tracking (nothing to secure or time yet).
    single(qualifier = named("pairing")) { ApiClient.baseHttpClient().build() }
    single { ApiClient.retrofit(get(qualifier = named("pairing"))).create(PairingApi::class.java) }

    // Refresh client — no authenticator, to break the chicken-and-egg inside refresh.
    single(qualifier = named("device_refresh")) { ApiClient.baseHttpClient().build() }
    single { ApiClient.retrofit(get(qualifier = named("device_refresh"))).create(DeviceApi::class.java) }
    single<RefreshAdapter> { RetrofitRefreshAdapter(get()) }

    // Authed client — Bearer interceptor + TokenAuthenticator + Date-header capture.
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

    single {
        RunningCoordinator(
            context = androidContext(),
            authedHttpClient = get(qualifier = named("authed")),
            configApi = get(),
            heartbeatApi = get(),
            cacheStatusApi = get(),
            skewTracker = get(),
            json = get(),
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

- [ ] **Step 2: Build verification**

```bash
cd android-tv && ./gradlew :app:assembleDebug
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt
git commit -m "feat(android): AppModule — register coordinator + authed config/heartbeat/cache-status APIs"
```

### Task 7.4 — Wire `MainActivity` to start/stop the coordinator

**Files:**
- Modify: `android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt`

- [ ] **Step 1: Rewrite MainActivity**

```kotlin
// android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt
package com.ouie.signage

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
import com.ouie.signage.auth.TokenSource
import com.ouie.signage.coordinator.RunningCoordinator
import com.ouie.signage.error.ErrorScreen
import com.ouie.signage.pairing.PairingScreen
import com.ouie.signage.running.RunningScreen
import com.ouie.signage.state.AppState
import com.ouie.signage.state.AppStateHolder
import org.koin.android.ext.android.inject

class MainActivity : ComponentActivity() {

    private val appState: AppStateHolder by inject()
    private val tokenStore: TokenSource by inject()
    private val coordinator: RunningCoordinator by inject()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Cold-start recovery from 3a: if tokens exist, go straight to Running.
        // Coordinator will start below when AppState emits Running.
        tokenStore.loadSync()?.let { appState.toRunning(it.deviceId) }

        setContent { SignageRoot(appState, coordinator) }
    }

    override fun onDestroy() {
        super.onDestroy()
        // Activity going away — stop loops. On configuration change Android will
        // re-create the activity; coordinator.start() is idempotent on the next
        // Running emission.
        coordinator.stop()
    }
}

@Composable
private fun SignageRoot(appState: AppStateHolder, coordinator: RunningCoordinator) {
    val state by appState.state.collectAsState()
    LaunchedEffect(state) {
        // Tie coordinator lifecycle to AppState.Running. If we ever enter Pairing
        // or Error, stop the loops so we don't hammer the server with a revoked
        // token.
        when (state) {
            is AppState.Running -> coordinator.start()
            else -> coordinator.stop()
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

- [ ] **Step 2: Build verification**

```bash
cd android-tv && ./gradlew :app:assembleDebug
```

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt
git commit -m "feat(android): MainActivity — start/stop RunningCoordinator on AppState.Running"
```

### Task 7.5 — Bump `versionName` + full test pass

**Files:**
- Modify: `android-tv/app/build.gradle.kts`

- [ ] **Step 1: Bump the version name**

```kotlin
// inside defaultConfig { ... } — change:
versionName = "0.2.0-3b"
```

- [ ] **Step 2: Run every unit test**

```bash
cd android-tv && ./gradlew :app:testDebugUnitTest
```

Expected: GREEN across all of Plan 3a's + Plan 3b's tests. Tally should be 10 test classes (3 from 3a + 7 from 3b) with ~35 tests passing in total.

- [ ] **Step 3: Commit**

```bash
git add android-tv/app/build.gradle.kts
git commit -m "chore(android): bump versionName to 0.2.0-3b"
```

---

# Phase 8 — Integration smoke on the emulator

Goal: prove the full happy path works against production Supabase + R2 from a fresh APK install on `atv34`.

### Task 8.1 — Pair, upload media, assign playlist

**Files:** none (acceptance task)

- [ ] **Step 1: Start the `atv34` emulator**

```bash
"$ANDROID_HOME/emulator/emulator" -list-avds
"$ANDROID_HOME/emulator/emulator" -avd atv34 -no-snapshot -no-boot-anim &
adb wait-for-device shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 1; done; echo booted'
```

- [ ] **Step 2: Clear any 3a state + install fresh APK**

```bash
adb shell pm clear com.ouie.signage.debug || true
cd android-tv && ./gradlew :app:installDebug
adb shell am start -n com.ouie.signage.debug/com.ouie.signage.MainActivity
```

Expected: pairing screen appears with a 6-char code.

- [ ] **Step 3: Claim the code from the dashboard**

Open `https://signage-ouie.vercel.app/app/screens/add`, enter the code, pick a store, name the TV "3b Emulator", submit.

Expected: emulator flips to `RunningScreen` within ≤ 3 s. Screen is black (no content yet).

- [ ] **Step 4: Verify heartbeat populated the device row**

Open `https://signage-ouie.vercel.app/app/screens/<device-id>` and watch the detail page. Within ≤ 60 s:
- Status pill flips to `online` with a recent timestamp.
- App version shows `0.2.0-3b`.
- Clock skew shows a value (likely 0–5 s on an emulator).
- Cache storage card shows the internal cache with total/free bytes.

Run `adb logcat -s OkHttp:* | grep devices-heartbeat` — confirm one POST every 60 s, all 204s.

- [ ] **Step 5: Upload media + playlist + rule**

Still in the dashboard:
1. `/app/media` → upload a small MP4 (< 30 s, < 30 MB) and a JPEG.
2. `/app/playlists` → create playlist "Lunch Loop"; add the image (duration 5 s) and the video (duration left blank — use video's native length).
3. `/app/screens/<device-id>` → assign "Lunch Loop" as the fallback playlist.

- [ ] **Step 6: Observe config sync + media download**

Within ≤ 60 s the emulator's ConfigPoller catches the new config. In `adb logcat -s OkHttp:*`:
- `GET /functions/v1/devices-config → 200`
- Two media downloads (you'll see GETs to `*.r2.cloudflarestorage.com`), each ending 200.
- `POST /functions/v1/devices-cache-status → 204` with the cached events.

In the dashboard device detail page, "Recent cache events" shows `cached · media abcd1234…` lines.

- [ ] **Step 7: Observe playback**

On the emulator screen:
1. After "Preparing content…" for a few seconds (download+cache) it flips to the first item.
2. The image shows for 5 s, then the video plays to end, then loops back to image.

Screenshot for the PR:

```bash
adb exec-out screencap -p > /tmp/plan3b-playback-image.png
# ... wait for it to advance ...
adb exec-out screencap -p > /tmp/plan3b-playback-video.png
```

- [ ] **Step 8: Verify force-stop + relaunch keeps playing**

```bash
adb shell am force-stop com.ouie.signage.debug
adb shell am start -n com.ouie.signage.debug/com.ouie.signage.MainActivity
```

Expected: app re-enters `RunningScreen` directly (token rehydrate from 3a), cache rehydrates from `media.db`, playback resumes within ≤ 2 s without re-downloading.

- [ ] **Step 9: Dashboard "Sync Now" — best-effort observation**

Click Sync Now on the device detail page. Dashboard optimistically shows "Sync triggered". The emulator has no FCM wired up (3c), so this has no observable effect beyond the dashboard's optimistic UI — that's expected. No regression.

- [ ] **Step 10: Phase close commit**

```bash
git commit --allow-empty -m "chore(android): Phase 8 emulator acceptance — heartbeat + config + playback verified"
```

### Task 8.2 — (optional if the user has a real TV today) Real-hardware acceptance

**Files:** none

- [ ] **Step 1: `adb connect <tv-ip>:5555` + install**

```bash
adb connect <tv-ip>:5555
cd android-tv && ./gradlew :app:installDebug
adb -s <tv-ip>:5555 shell am start -n com.ouie.signage.debug/com.ouie.signage.MainActivity
```

- [ ] **Step 2: Repeat Task 8.1 Steps 3–8 on the physical TV**

Key difference to document: the cache root may be an external volume (if the TV has a USB stick plugged in). `cache_storage_info.root` should read `external` in that case.

- [ ] **Step 3: Factory-style clear afterward**

```bash
adb -s <tv-ip>:5555 shell pm clear com.ouie.signage.debug
# Dashboard: delete the test device from /app/screens
```

- [ ] **Step 4: Commit**

```bash
git commit --allow-empty -m "chore(android): Phase 8 real-hardware acceptance — <brand/model> playback verified"
```

*Skip if no real TV is available; real-hardware acceptance can land in a follow-up commit on the branch before merge.*

---

# Phase 9 — Docs + CLAUDE.md

### Task 9.1 — Update root CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Status line**

Change the current top-of-file Status line to reflect Plan 3b shipping, preserving the history of what was there. Example post-edit text:

```
**Status (as of 2026-04-24):** **Plans 1 + 2 + 2.1 + 2.2 + 3a + 3b complete. Dashboard live at https://signage-ouie.vercel.app; Android TV APK pairs, heartbeats, syncs config, downloads media, and plays through ExoPlayer/Compose.**
```

And reflect that 3b acceptance completed on emulator (+ optionally physical TV).

- [ ] **Step 2: Add "Plans 3b (done)" to Key file pointers**

```
- Plan 3b (done): `docs/superpowers/plans/2026-04-23-plan-3b-android-playback.md`
```

Leave the "Plans 3c — FCM + boot receiver + launcher hardening — not yet written" line in place.

- [ ] **Step 3: Add a few 3b-specific conventions under "Conventions decided during this project"**

```
- **Android cache root selection (Plan 3b).** `RunningCoordinator.pickCacheRoot` looks at `getExternalFilesDirs(null)` (ignoring the first entry, which is emulated-internal) + `StorageManager.getStorageVolumes()`, picks the external dir with the most free bytes above a 4 GB threshold, and falls back to internal with `cache_storage_info.degraded = true` otherwise. `filesystem` is reported as `"unknown"` in 3b — detecting FAT/exFAT requires hacks not worth v1.
- **Per-process coordinator.** `RunningCoordinator` is a Koin `single` that owns one CoroutineScope and is started/stopped by MainActivity in response to `AppState.Running`. All long-running loops (heartbeat, config poll, media sync, playback ticker) live inside that scope; Activity destruction cancels them.
- **`explicitNulls = false` on the shared Json.** The authed `HeartbeatPayload` has nullable fields that the server treats as "omitted" — kotlinx.serialization's default is to emit `"key": null`, which also works but clutters logs. The global Json in the Koin module carries `explicitNulls = false`.
- **Media sync is eager in 3b, not window-gated.** Spec §6.2's sync-window (02:00–05:00) is scheduled but not enforced by the device — the playback loop triggers downloads whenever `desired is not cached`. Revisit once we have real operational data on network/thrashing.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): plan 3b shipped — heartbeat + config sync + playback live"
```

### Task 9.2 — End-of-plan close commit

**Files:** none

- [ ] **Step 1: Empty close commit**

```bash
git commit --allow-empty -m "feat(android): plan 3b — heartbeat + config sync + playback live on emulator"
```

---

## Appendix A — Acceptance matrix

| Scenario | Expected behavior |
|---|---|
| Fresh APK, no config yet | Pair → immediately enters Running → black screen, coordinator loops start. |
| Pair + dashboard assigns fallback playlist | Within ≤ 60 s config poll: device downloads media, shows "Preparing…" once, then plays first item. |
| Dashboard uploads a new media item into the currently-playing playlist | Within ≤ 60 s: device downloads new item, playback loop incorporates it on next iteration (no mid-item interruption). |
| Dashboard creates a dayparting rule covering the current time, targeting the device | Within ≤ 60 s: device switches to the new playlist once the new playlist is fully cached. If not cached, keeps playing the previous one. |
| Force-stop + relaunch | Boots straight into Running, rehydrates cache from `media.db`, resumes playback within ≤ 2 s. |
| Access token expires | `TokenAuthenticator` refreshes transparently on next 401. No user-visible glitch. |
| Device revoked from dashboard | Next refresh 401s → `TokenAuthenticator` clears tokens → `AppState` flips to Pairing on the next emission from any authed call. Playback stops, pairing screen shows a new code. |
| No rules, no fallback_playlist_id | "No content configured" black screen. |
| Config 5xx for ≤ 60 s | Playback continues from cached playlist. Exponential backoff on poller. |
| Media file checksum mismatch | `cache_events` reports `failed` with message; device does NOT cache the bad blob; next poll will try again. |

## Appendix B — Explicit non-goals for 3b

- **FCM.** `google-services.json` isn't wired. "Sync Now" from dashboard triggers FCM server-side but device ignores; 60 s poll is the path. 3c.
- **BOOT_COMPLETED / foreground service.** Rebooting the TV requires manual launch. 3c.
- **LRU eviction of GONE media.** We leave stale cached files on disk forever in 3b. 3c.
- **Preload-via-USB scan.** The cache-root selector picks external dirs when viable, but it doesn't scan a sibling `preload/` folder. 3c.
- **Playback error recovery UI.** If ExoPlayer chokes on a broken MP4, the current frame freezes. Spec §7's "skip item, log, advance" is honored at the PlaybackDirector level but not plumbed into ExoPlayer listeners. 3c or v1.1.
- **Signed preload manifests.** Post-v1.
- **`errors_since_last_heartbeat` in the heartbeat payload.** Requires an error bus we don't have yet. 3c.

## Appendix C — Known risks specific to 3b

1. **MediaCacheIndex SQLite schema versioning.** DB_VERSION=1; `onUpgrade` drops+recreates. Safe for v1; if we ever bump, rows are re-populated from the next config's downloads. The on-disk blobs still exist — re-inserting rows simply marks them cached again on the next `rehydrate` call.
2. **ExoPlayer release on rapid playlist flips.** `VideoPlayerHost`'s `DisposableEffect(player)` releases the ExoPlayer when the Composable leaves. If the playback director flips video→image→video rapidly (< 1 s), we allocate and release players in sequence. Usually fine (Media3 is cheap to construct), but worth watching in 3c for leak reports.
3. **`android.os.storage.StorageManager.getStorageVolumes()` on non-TV Android forks.** On some MIUI TV skins, this returns nothing for mounted USB. Fallback to `getExternalFilesDirs(null)` is the primary path; we only call StorageManager as a bonus. 3c hardens this.
4. **Clock-skew accuracy < 1 s.** `ClockSkewTracker` uses epoch-second math (`Date:` HTTP header has 1 s precision). Spec §8 flags > 120 s skew as a problem; 1 s rounding is within tolerance.
5. **MediaDownloader's `httpClient` is the same authed one the loops use.** If a huge download is in flight, a concurrent heartbeat is serialized behind it at OkHttp's connection-pool level (though OkHttp will open a second connection if the pool is empty). Watch for heartbeat timeouts during the first media sync on a fresh install. Mitigation if observed in Phase 8: split off a `named("downloader")` OkHttpClient with its own connection pool.
6. **Compose `collectAsState` + rapid playlist flips.** If the director emits Playing → Preparing → Playing in < a frame (e.g., on a cache refresh race), the screen may glitch. We've kept Preparing as a valid intermediate state so the customer sees "Preparing…" briefly rather than a blank frame; the director's tick is 1 Hz so this window is small.

---

**End of Plan 3b.**
