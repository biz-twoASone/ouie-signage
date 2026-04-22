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
