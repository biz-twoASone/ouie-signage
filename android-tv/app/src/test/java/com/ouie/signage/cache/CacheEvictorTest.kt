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
