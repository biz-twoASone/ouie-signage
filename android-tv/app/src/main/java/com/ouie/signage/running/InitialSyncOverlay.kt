// android-tv/app/src/main/java/com/ouie/signage/running/InitialSyncOverlay.kt
// Plan 5 Phase 2 Task 15.
// Branded "syncing menu..." overlay shown by RunningScreen when the device
// has no playable media yet (initial sync after pairing or after cache wipe).
// Hides as soon as PlaybackDirector advances into a Playing/Preparing state.
package com.ouie.signage.running

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.colorResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Text
import com.ouie.signage.R

@Composable
fun InitialSyncOverlay(message: String = "Syncing menu…") {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colorResource(id = R.color.brand_green)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Image(
                painter = painterResource(id = R.mipmap.ic_launcher_foreground),
                contentDescription = null,
                modifier = Modifier.size(192.dp),
            )
            CircularProgressIndicator(color = Color.White)
            Text(text = message, color = Color.White)
        }
    }
}
