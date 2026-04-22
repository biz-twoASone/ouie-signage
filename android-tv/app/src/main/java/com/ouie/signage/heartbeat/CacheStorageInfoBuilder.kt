// android-tv/app/src/main/java/com/ouie/signage/heartbeat/CacheStorageInfoBuilder.kt
package com.ouie.signage.heartbeat

import android.os.StatFs
import com.ouie.signage.cache.CacheRootResolver
import java.time.Instant

object CacheStorageInfoBuilder {
    fun buildFrom(pick: CacheRootResolver.Pick): CacheStorageInfo {
        // StatFs reads live values each time; the resolver's `freeBytes` is only
        // a snapshot from selection time. Refresh here so the dashboard shows
        // accurate numbers.
        val stats = try { StatFs(pick.root.absolutePath) } catch (_: Throwable) { null }
        val totalBytes = stats?.let { it.blockCountLong * it.blockSizeLong } ?: 0L
        val freeBytes  = stats?.let { it.availableBlocksLong * it.blockSizeLong } ?: pick.freeBytes

        return CacheStorageInfo(
            root = if (pick.kind == CacheRootResolver.Kind.External) "external" else "internal",
            filesystem = "unknown",   // 3b limitation; revisit in 3c when USB detection matters
            total_bytes = totalBytes,
            free_bytes = freeBytes,
            updated_at = Instant.now().toString(),
            degraded = pick.degraded,
        )
    }
}
