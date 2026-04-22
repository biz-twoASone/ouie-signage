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
