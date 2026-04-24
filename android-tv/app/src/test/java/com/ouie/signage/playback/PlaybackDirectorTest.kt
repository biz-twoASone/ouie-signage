// android-tv/app/src/test/java/com/ouie/signage/playback/PlaybackDirectorTest.kt
package com.ouie.signage.playback

import com.ouie.signage.config.ConfigDto
import com.ouie.signage.config.DeviceDto
import com.ouie.signage.config.MediaDto
import com.ouie.signage.config.PlaylistDto
import com.ouie.signage.config.PlaylistItemDto
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.io.File

@OptIn(ExperimentalCoroutinesApi::class)
class PlaybackDirectorTest {

    private fun cfg(vararg mediaIds: String): ConfigDto = ConfigDto(
        version = "v1",
        device = DeviceDto("dev-1", "store-1", fallback_playlist_id = "pl", timezone = "UTC"),
        playlists = listOf(
            PlaylistDto(
                id = "pl", name = "p", updated_at = "2026-04-01T00:00:00Z",
                items = mediaIds.mapIndexed { i, id ->
                    PlaylistItemDto(media_id = id, position = i + 1, duration_seconds = 5.0)
                },
            ),
        ),
        media = mediaIds.map {
            MediaDto(id = it, kind = "image", size_bytes = 0, checksum = "", url = "/$it.jpg")
        },
    )

    private fun director(
        cfg: ConfigDto?,
        cached: Set<String> = emptySet(),
        fileExists: Boolean = true,
    ): PlaybackDirector {
        // Use a real temp file so `File.exists()` returns true for cached items.
        // Tests that want "file missing" pass fileExists=false and we return a
        // non-existent path instead.
        val tmpFile = if (fileExists) {
            File.createTempFile("playback-test", ".bin").apply { deleteOnExit() }
        } else {
            File("/does/not/exist.bin")
        }
        return PlaybackDirector(
            config = MutableStateFlow(cfg),
            cachedMediaIds = MutableStateFlow(cached),
            fileFor = { _ -> tmpFile },
            clock = Clock.fixed(Instant.parse("2026-04-23T10:00:00Z"), ZoneOffset.UTC),
        )
    }

    @Test
    fun `null config emits NoContent`() = runTest {
        val d = director(cfg = null)
        d.tick()
        assertEquals(PlaybackState.NoContent, d.state.first())
    }

    @Test
    fun `config with fallback + nothing cached emits Preparing`() = runTest {
        val d = director(cfg = cfg("m1", "m2"), cached = emptySet())
        d.tick()
        assertEquals(PlaybackState.Preparing, d.state.first())
    }

    @Test
    fun `desired fully cached emits Playing starting at index 0`() = runTest {
        val d = director(cfg = cfg("m1", "m2"), cached = setOf("m1", "m2"))
        d.tick()
        val state = d.state.first() as PlaybackState.Playing
        assertEquals("pl", state.playlistId)
        assertEquals(0, state.index)
        assertEquals("m1", state.item.mediaId)
    }

    @Test
    fun `advance moves to next item then loops`() = runTest {
        val d = director(cfg = cfg("m1", "m2"), cached = setOf("m1", "m2"))
        d.tick()
        d.advanceItem()
        assertEquals(1, (d.state.first() as PlaybackState.Playing).index)
        d.advanceItem()
        // Loop back to 0
        assertEquals(0, (d.state.first() as PlaybackState.Playing).index)
    }

    @Test
    fun `advanceItem on single-item playlist emits new generation`() = runTest {
        val d = director(cfg = cfg("m1"), cached = setOf("m1"))
        d.tick()   // enter Playing at index 0
        val first = d.state.first() as PlaybackState.Playing
        assertEquals("m1", first.item.mediaId)
        assertEquals(0, first.index)

        d.advanceItem()
        val second = d.state.first() as PlaybackState.Playing
        // Wrapping back to index 0 is correct for 1-item playlists.
        assertEquals(0, second.index)
        assertEquals("m1", second.item.mediaId)
        // Generation MUST differ so downstream collectors (Compose) receive a
        // fresh emission and can re-prepare the player.
        assert(second.generation > first.generation) {
            "expected generation to increment; first=${first.generation} second=${second.generation}"
        }
    }

    @Test
    fun `tick preserves generation when item is unchanged`() = runTest {
        val d = director(cfg = cfg("m1", "m2"), cached = setOf("m1", "m2"))
        d.tick()
        val first = d.state.first() as PlaybackState.Playing
        d.tick()   // same playlist, same index, same item
        val second = d.state.first() as PlaybackState.Playing
        assertEquals(
            "tick() must not churn generation for unchanged item — would cause 1Hz ExoPlayer restarts",
            first.generation,
            second.generation,
        )
    }
}
