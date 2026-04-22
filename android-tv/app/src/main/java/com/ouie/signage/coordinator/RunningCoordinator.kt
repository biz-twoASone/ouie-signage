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
    /**
     * Plain client for R2 presigned-URL media fetches. Must NOT carry a
     * Bearer Authorization header — R2 treats it as a conflicting auth method
     * alongside the SigV4 query params and rejects with 400. Kept separate
     * from the authed client below.
     */
    private val downloaderHttpClient: OkHttpClient,
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

        val downloader = MediaDownloader(downloaderHttpClient, layout)
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
