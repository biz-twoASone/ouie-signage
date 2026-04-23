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
