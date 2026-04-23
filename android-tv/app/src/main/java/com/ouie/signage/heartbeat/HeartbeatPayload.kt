// android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatPayload.kt
package com.ouie.signage.heartbeat

import com.ouie.signage.errorbus.ErrorEvent
import kotlinx.serialization.Serializable

@Serializable
data class HeartbeatPayload(
    val app_version: String,
    val uptime_seconds: Long,
    val current_playlist_id: String? = null,
    val last_config_version_applied: String? = null,
    val clock_skew_seconds_from_server: Int? = null,
    val cache_storage_info: CacheStorageInfo? = null,
    val errors_since_last_heartbeat: List<ErrorEvent> = emptyList(),
    /**
     * Latest FCM token known to the device. Null until FirebaseMessaging hands
     * one out (first fresh install can take a second or two). Sent on every
     * heartbeat so server-side rotations and reinstalls recover automatically.
     */
    val fcm_token: String? = null,
    /**
     * Timestamp of the last FCM message received by SignageMessagingService.
     * Paired with server-side last_sync_now_dispatched_at to compute delivery
     * latency on the dashboard. Null if no push has been received this process
     * lifetime.
     */
    val last_fcm_received_at: String? = null,
)

@Serializable
data class CacheStorageInfo(
    val root: String,
    val filesystem: String,
    val total_bytes: Long,
    val free_bytes: Long,
    val updated_at: String,
    val degraded: Boolean = false,
    /**
     * Preload summary (spec §4 JSONB shape). Absent in 3b's heartbeat; populated
     * in 3c once PreloadScanner has a last result. Null when the scanner hasn't
     * run or the preload folder isn't present.
     */
    val preload: com.ouie.signage.preload.PreloadStatus? = null,
)
