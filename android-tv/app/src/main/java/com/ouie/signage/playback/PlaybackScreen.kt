// android-tv/app/src/main/java/com/ouie/signage/playback/PlaybackScreen.kt
package com.ouie.signage.playback

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import kotlinx.coroutines.flow.StateFlow

@Composable
fun PlaybackScreen(
    state: StateFlow<PlaybackState>,
    onAdvanceItem: () -> Unit,
) {
    val s by state.collectAsState()
    when (val cur = s) {
        PlaybackState.NoContent -> NoContentScreen()
        PlaybackState.Preparing -> PreparingScreen()
        is PlaybackState.Playing -> {
            when (cur.item.kind) {
                PlaybackItem.Kind.Video -> VideoPlayerHost(
                    file = cur.item.localFile,
                    onEnded = onAdvanceItem,
                )
                PlaybackItem.Kind.Image -> ImageSlideHost(
                    file = cur.item.localFile,
                    durationSeconds = cur.item.durationSeconds,
                    onTimeout = onAdvanceItem,
                )
            }
        }
    }
}

@Composable
private fun PreparingScreen() {
    // Spec §6.3: customer-visible transient screen during cold start or post-switch
    // while the new playlist's media is still downloading.
    Box(
        Modifier.fillMaxSize().background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = "Preparing content…", color = Color(0xFFAAAAAA), fontSize = 20.sp)
    }
}
