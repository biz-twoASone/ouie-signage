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
