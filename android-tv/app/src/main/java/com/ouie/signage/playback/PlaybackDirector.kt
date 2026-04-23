// android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackDirector.kt
package com.ouie.signage.playback

import com.ouie.signage.config.ConfigDto
import com.ouie.signage.config.MediaDto
import com.ouie.signage.config.PlaylistDto
import com.ouie.signage.heartbeat.CurrentPlaylistSource
import com.ouie.signage.schedule.ScheduleResolver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.time.Clock
import java.time.ZoneId

/**
 * Flat view of PlaybackDirector state for observability. HeartbeatScheduler reads
 * these on each tick to populate current_media_id + playback_state in the payload.
 * Kept separate from CurrentPlaylistSource because heartbeat cares about the
 * narrower media-id + coarse state-tag, not the full PlaybackState sum-type.
 */
fun interface PlaybackStateSource {
    fun snapshot(): PlaybackStateSnapshot
}

data class PlaybackStateSnapshot(
    /** UUID of the currently-playing media item, or null if not in Playing state. */
    val currentMediaId: String?,
    /** One of "playing" | "preparing" | "no_content". */
    val stateTag: String,
)

/**
 * Selects the active playlist at ~1 Hz and exposes a PlaybackState StateFlow.
 * The actual item-advance (video-end, image-duration-elapsed) is driven by the
 * PlaybackScreen Compose layer calling `advanceItem()`.
 *
 * Cache-before-switch (spec §6.3): if the resolved desired playlist is not
 * fully cached AND we already have a cached current, we keep the current one
 * playing. If we have no current, we emit Preparing. The MediaSyncWorker is
 * doing the downloads in the background; as soon as the cache fills, the next
 * tick flips to Playing.
 *
 * The module is driven by flows the caller owns — config, cached media ids, group
 * memberships. No direct dependency on ConfigRepository / CacheManager, which
 * keeps this testable on the JVM.
 */
class PlaybackDirector(
    private val config: StateFlow<ConfigDto?>,
    private val cachedMediaIds: StateFlow<Set<String>>,
    private val fileFor: (mediaId: String) -> File?,
    private val clock: Clock = Clock.systemUTC(),
) : CurrentPlaylistSource, PlaybackStateSource {

    private val _state = MutableStateFlow<PlaybackState>(PlaybackState.NoContent)
    val state: StateFlow<PlaybackState> = _state.asStateFlow()

    /** 0-based index inside the currently-playing playlist. */
    private var currentIndex: Int = 0

    override fun current(): String? = (state.value as? PlaybackState.Playing)?.playlistId

    override fun snapshot(): PlaybackStateSnapshot {
        val s = _state.value
        return PlaybackStateSnapshot(
            currentMediaId = (s as? PlaybackState.Playing)?.item?.mediaId,
            stateTag = when (s) {
                is PlaybackState.Playing -> "playing"
                PlaybackState.Preparing -> "preparing"
                PlaybackState.NoContent -> "no_content"
            },
        )
    }

    private var tickerJob: Job? = null

    fun startTicker(scope: CoroutineScope, intervalMs: Long = 1_000) {
        if (tickerJob?.isActive == true) return
        tickerJob = scope.launch {
            while (isActive) {
                tick()
                try { delay(intervalMs) } catch (e: CancellationException) { throw e }
            }
        }
    }

    fun stopTicker() {
        tickerJob?.cancel()
        tickerJob = null
    }

    /** Visible for unit tests. */
    fun tick() {
        val cfg = config.value
        if (cfg == null) {
            _state.value = PlaybackState.NoContent
            return
        }
        val nowLocal = java.time.ZonedDateTime.ofInstant(
            clock.instant(),
            ZoneId.of(cfg.device.timezone),
        )
        val desiredPlaylistId = ScheduleResolver.resolve(
            device = cfg.device,
            rules = cfg.rules,
            nowLocal = nowLocal,
        )
        if (desiredPlaylistId == null) {
            _state.value = PlaybackState.NoContent
            return
        }
        val playlist = cfg.playlists.firstOrNull { it.id == desiredPlaylistId }
        if (playlist == null || playlist.items.isEmpty()) {
            _state.value = PlaybackState.NoContent
            return
        }
        val cached = cachedMediaIds.value
        val allCached = playlist.items.all { it.media_id in cached }
        if (!allCached) {
            // Spec §6.3: keep playing current if it's still cached.
            val currentPlaying = _state.value as? PlaybackState.Playing
            if (currentPlaying != null &&
                currentPlaying.playlistId != desiredPlaylistId &&
                currentPlaying.item.mediaId in cached
            ) {
                // Intentionally keep the current playing — do NOT flip yet.
                return
            }
            if (currentPlaying != null && currentPlaying.playlistId == desiredPlaylistId &&
                currentPlaying.item.mediaId in cached) {
                // Still playing this playlist and current item is cached; continue.
                return
            }
            _state.value = PlaybackState.Preparing
            return
        }

        val needsSwitch = (_state.value as? PlaybackState.Playing)?.playlistId != desiredPlaylistId
        if (needsSwitch) currentIndex = 0
        currentIndex = currentIndex.coerceIn(0, playlist.items.size - 1)
        val item = buildItem(playlist, cfg.media, currentIndex) ?: run {
            // File went missing between cache flow and now — treat as not cached.
            _state.value = PlaybackState.Preparing
            return
        }
        _state.value = PlaybackState.Playing(playlist.id, currentIndex, item)
    }

    /** Called by PlaybackScreen when the current item's duration elapsed / video ended. */
    fun advanceItem() {
        val cfg = config.value ?: return
        val s = state.value as? PlaybackState.Playing ?: return
        val pl = cfg.playlists.firstOrNull { it.id == s.playlistId } ?: return
        currentIndex = (s.index + 1) % pl.items.size
        val next = buildItem(pl, cfg.media, currentIndex) ?: return
        _state.value = PlaybackState.Playing(pl.id, currentIndex, next)
    }

    private fun buildItem(pl: PlaylistDto, media: List<MediaDto>, idx: Int): PlaybackItem? {
        val pi = pl.items.getOrNull(idx) ?: return null
        val m = media.firstOrNull { it.id == pi.media_id } ?: return null
        val file = fileFor(pi.media_id) ?: return null
        if (!file.exists()) return null
        return PlaybackItem(
            mediaId = m.id,
            kind = if (m.kind == "video") PlaybackItem.Kind.Video else PlaybackItem.Kind.Image,
            localFile = file,
            durationSeconds = when {
                m.kind == "video" -> pi.duration_seconds ?: m.video_duration_seconds ?: 0.0
                else -> pi.duration_seconds ?: 5.0    // image default 5s if operator omitted
            },
        )
    }
}
