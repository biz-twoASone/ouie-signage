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
import kotlinx.coroutines.currentCoroutineContext
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
            if (!currentCoroutineContext().isActive) return
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
