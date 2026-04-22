// android-tv/app/src/main/java/com/ouie/signage/playback/VideoPlayerHost.kt
package com.ouie.signage.playback

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import java.io.File

/**
 * Hosts an ExoPlayer + PlayerView inside Compose via AndroidView. When [file]
 * changes, replaces the media item and re-plays. When the Composition leaves,
 * releases the player.
 *
 * `onEnded` fires when the single media item finishes (we do NOT loop a single
 * video; looping happens at the playlist level via PlaybackDirector.advanceItem).
 */
@Composable
fun VideoPlayerHost(file: File, onEnded: () -> Unit) {
    val context = LocalContext.current
    val endedCallback by rememberUpdatedState(onEnded)

    val player = remember {
        ExoPlayer.Builder(context).build().apply {
            playWhenReady = true
            repeatMode = Player.REPEAT_MODE_OFF
        }
    }

    LaunchedEffect(file) {
        player.setMediaItem(MediaItem.fromUri(file.toURI().toString()))
        player.prepare()
    }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) endedCallback()
            }
        }
        player.addListener(listener)
        onDispose {
            player.removeListener(listener)
            player.release()
        }
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            PlayerView(ctx).apply {
                useController = false
                this.player = player
                setShutterBackgroundColor(android.graphics.Color.BLACK)
            }
        },
    )
}
