// android-tv/app/src/main/java/com/ouie/signage/heartbeat/HeartbeatPayload.kt
package com.ouie.signage.heartbeat

import kotlinx.serialization.Serializable

/**
 * Shape exactly matches spec §8 and `supabase/functions/devices-heartbeat/index.ts`
 * (which accepts these fields and silently ignores unknown ones). `snake_case`
 * wire format throughout.
 *
 * `errors_since_last_heartbeat` from the spec is omitted in 3b — we don't yet
 * have a local error bus worth reporting. Revisit in 3c when playback errors
 * and FCM delivery events become worth surfacing.
 */
@Serializable
data class HeartbeatPayload(
    val app_version: String,
    val uptime_seconds: Long,
    val current_playlist_id: String? = null,
    val last_config_version_applied: String? = null,
    val clock_skew_seconds_from_server: Int? = null,
    val cache_storage_info: CacheStorageInfo? = null,
)

@Serializable
data class CacheStorageInfo(
    /** "internal" | "external" — matches spec §4 JSONB shape */
    val root: String,
    /** "ext4" | "exfat" | "fat32" | "unknown" — v1 reports "unknown" */
    val filesystem: String,
    val total_bytes: Long,
    val free_bytes: Long,
    /** ISO-8601 UTC */
    val updated_at: String,
    /** True when we fell back to internal because no viable external was found. */
    val degraded: Boolean = false,
)
