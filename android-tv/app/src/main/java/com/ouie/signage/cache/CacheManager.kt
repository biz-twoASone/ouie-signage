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
