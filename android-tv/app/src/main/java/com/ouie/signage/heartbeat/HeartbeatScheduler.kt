// android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatScheduler.kt
package com.ouie.signage.heartbeat

import android.os.SystemClock
import com.ouie.signage.BuildConfig
import com.ouie.signage.cache.CacheRootResolver
import com.ouie.signage.config.ConfigRepository
import com.ouie.signage.errorbus.ErrorBus
import com.ouie.signage.fcm.FcmReceiptTracker
import com.ouie.signage.fcm.FcmTokenSource
import com.ouie.signage.net.HeartbeatApi
import com.ouie.signage.playback.PlaybackStateSource
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
    private val fcmReceiptTracker: FcmReceiptTracker,
    private val playbackStateSource: PlaybackStateSource,
    private val intervalMs: Long = 60_000,
) {

    private var job: Job? = null
    private var firstAfterBoot: Boolean = true
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

    /**
     * Plan 5 Task 21: speculative FCM-socket-stickiness mitigation. On the
     * first heartbeat after process start, force a token re-acquire — exercises
     * the GMS path which (per Plan 4.1 follow-up hypothesis) may unstick post-reboot
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

    private suspend fun sendOne() {
        maybeForceFcmRefresh()
        val uptimeSeconds = (SystemClock.elapsedRealtime() - processStartRealtime) / 1000
        val pick = pickProvider()
        val cacheInfo = pick?.let {
            CacheStorageInfoBuilder.buildFrom(it, preloadStatusSource.current())
        }
        val errors = errorBus.drain()
        val fcm = fcmTokenSource.current()
        val fcmReceived = fcmReceiptTracker.current()?.toString()
        val playbackSnapshot = playbackStateSource.snapshot()
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
            current_media_id = playbackSnapshot.currentMediaId,
            playback_state = playbackSnapshot.stateTag,
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
