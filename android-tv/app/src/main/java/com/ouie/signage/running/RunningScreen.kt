// android-tv/app/src/main/java/com/ouie/signage/running/RunningScreen.kt
package com.ouie.signage.running

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.ouie.signage.coordinator.RunningCoordinator
import com.ouie.signage.playback.PlaybackScreen
import org.koin.compose.koinInject

@Composable
fun RunningScreen(deviceId: String) {
    val coordinator: RunningCoordinator = koinInject()
    val director by coordinator.playbackDirector.collectAsState()
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        val d = director
        if (d != null) {
            PlaybackScreen(state = d.state, onAdvanceItem = { d.advanceItem() })
        }
        // While coordinator is still starting (a few hundred ms at most), keep
        // the screen black. No spinner — we never want to show loading chrome
        // to customers.
    }
}
