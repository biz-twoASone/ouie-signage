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
import kotlinx.coroutines.ensureActive
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
