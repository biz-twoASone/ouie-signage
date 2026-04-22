// android-tv/app/src/main/java/com/ouie/signage/config/ConfigDto.kt
package com.ouie.signage.config

import kotlinx.serialization.Serializable

@Serializable
data class ConfigDto(
    val version: String,        // e.g., "sha256:abc123..."
    val device: DeviceDto,
    val rules: List<RuleDto> = emptyList(),
    val playlists: List<PlaylistDto> = emptyList(),
    val media: List<MediaDto> = emptyList(),
)

@Serializable
data class DeviceDto(
    val id: String,
    val store_id: String,
    val fallback_playlist_id: String? = null,
    val timezone: String,       // IANA, e.g., "Asia/Jakarta"
)

@Serializable
data class RuleDto(
    val id: String,
    val playlist_id: String,
    val target_device_id: String? = null,
    val target_device_group_id: String? = null,
    val days_of_week: List<Int>,      // ISO 1=Mon..7=Sun
    val start_time: String,            // "HH:MM:SS" (Postgres `time` stringification)
    val end_time: String,
    val effective_at: String,          // ISO-8601 UTC
)

@Serializable
data class PlaylistDto(
    val id: String,
    val name: String,
    val updated_at: String,
    val items: List<PlaylistItemDto>,
)

@Serializable
data class PlaylistItemDto(
    val media_id: String,
    val position: Int,
    val duration_seconds: Double? = null,
)

@Serializable
data class MediaDto(
    val id: String,
    val kind: String,                 // "video" | "image"
    val size_bytes: Long,
    val checksum: String,             // lowercase hex sha256
    val video_duration_seconds: Double? = null,
    val url: String,                  // signed R2 GET URL, 24h TTL
)
