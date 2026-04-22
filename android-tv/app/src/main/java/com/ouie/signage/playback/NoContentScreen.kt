// android-tv/app/src/main/java/com/ouie/signage/playback/NoContentScreen.kt
package com.ouie.signage.playback

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text

/** Customer-visible fallback when no rule and no fallback_playlist are set. */
@Composable
fun NoContentScreen(message: String = "No content configured") {
    Box(
        Modifier.fillMaxSize().background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = message, color = Color(0xFF666666), fontSize = 22.sp)
    }
}
