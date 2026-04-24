// android-tv/app/src/main/java/com/ouie/signage/playback/ImageSlideHost.kt
package com.ouie.signage.playback

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import kotlinx.coroutines.delay
import java.io.File

/**
 * Renders a local image and invokes onTimeout after `durationSeconds` to trigger
 * advance. Decoding is synchronous on first composition — images are small
 * enough (< 10 MB typical for signage JPEG) that the frame hitch is acceptable.
 *
 * Uses `androidx.compose.foundation.Image` rather than Coil/Glide: we have the
 * bitmap on disk already, and pulling in Coil just for this is overkill.
 */
@Composable
fun ImageSlideHost(file: File, generation: Long, durationSeconds: Double, onTimeout: () -> Unit) {
    val bitmap = remember(file) { BitmapFactory.decodeFile(file.absolutePath) }
    val timeoutCallback by rememberUpdatedState(onTimeout)

    LaunchedEffect(file, generation, durationSeconds) {
        // durationSeconds can be 0 if the config is malformed; guard against that
        // so we don't end up advancing in a tight loop.
        val ms = (durationSeconds.coerceAtLeast(1.0) * 1000).toLong()
        delay(ms)
        timeoutCallback()
    }

    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit,
            )
        }
    }
}
