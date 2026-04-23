// android-tv/app/src/main/java/com/ouie/signage/errorbus/ErrorEvent.kt
package com.ouie.signage.errorbus

import kotlinx.serialization.Serializable

/**
 * Spec §8 `errors_since_last_heartbeat` shape. Sent to the server as part of
 * the heartbeat payload; in 3c the server ignores unknown keys, so this is
 * client-only observability until a future plan persists it.
 */
@Serializable
data class ErrorEvent(
    val timestamp: String,      // ISO-8601 UTC
    val kind: String,           // "download_failed" | "playback_failed" | ...
    val media_id: String?,
    val message: String?,
)
