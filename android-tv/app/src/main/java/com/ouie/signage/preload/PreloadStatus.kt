// android-tv/app/src/main/java/com/ouie/signage/preload/PreloadStatus.kt
package com.ouie.signage.preload

import kotlinx.serialization.Serializable

/**
 * Matches spec §4 `cache_storage_info.preload` JSONB shape exactly. Emitted via
 * the heartbeat payload so the dashboard can render matched / unmatched counts.
 */
@Serializable
data class PreloadStatus(
    val path: String,
    val present: Boolean,
    val file_count: Int,
    val matched_count: Int,
    val unmatched: List<UnmatchedItem> = emptyList(),
)

@Serializable
data class UnmatchedItem(
    val filename: String,
    val size_bytes: Long,
    val sha256: String,
    val seen_at: String,
)

/**
 * Called by HeartbeatScheduler each tick to embed the last scan result.
 */
fun interface PreloadStatusSource {
    fun current(): PreloadStatus?
}
