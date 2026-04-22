// android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackState.kt
package com.ouie.signage.playback

sealed interface PlaybackState {
    /** No rule matches and no fallback — show "No content configured". */
    data object NoContent : PlaybackState

    /**
     * A playlist is desired but not fully cached yet. We're either starting fresh
     * or a schedule just flipped. Show "Preparing content…" to avoid a customer-
     * facing error. Spec §6.3: never interrupt an already-playing cached playlist
     * for this.
     */
    data object Preparing : PlaybackState

    /** Playing an item from a cached playlist. */
    data class Playing(
        val playlistId: String,
        val index: Int,
        val item: PlaybackItem,
    ) : PlaybackState
}
