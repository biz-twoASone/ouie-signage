// android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackItem.kt
package com.ouie.signage.playback

import java.io.File

/**
 * Normalised playback unit — what the screen actually renders. Derived from
 * PlaylistItemDto + MediaDto + CacheManager.fileFor(). Not wire-serialized;
 * lives in-memory only.
 */
data class PlaybackItem(
    val mediaId: String,
    val kind: Kind,
    val localFile: File,
    val durationSeconds: Double,  // for images: the operator-set duration.
                                  // for videos: defaults to video_duration_seconds or 0 (ExoPlayer drives).
) {
    enum class Kind { Video, Image }
}
