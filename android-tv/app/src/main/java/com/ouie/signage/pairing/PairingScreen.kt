// android-tv/app/src/main/java/com/ouie/signage/pairing/PairingScreen.kt
package com.ouie.signage.pairing

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import kotlinx.coroutines.delay
import org.koin.androidx.compose.koinViewModel

@Composable
fun PairingScreen(viewModel: PairingViewModel = koinViewModel()) {
    val ui by viewModel.ui.collectAsState()

    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black).padding(64.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Text(
                text = "Pair this TV",
                color = Color.White,
                fontSize = 32.sp,
                fontWeight = FontWeight.Light,
            )

            if (ui.isRequesting || ui.code == null) {
                CircularProgressIndicator(color = Color.White)
                Text("Requesting pairing code…", color = Color.Gray, fontSize = 16.sp)
            } else {
                Text(
                    text = "Enter this code in your dashboard:",
                    color = Color.Gray,
                    fontSize = 18.sp,
                )
                Text(
                    text = ui.code!!,
                    color = Color.White,
                    fontSize = 96.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace,
                )
                CountdownText(expiresAtIso = ui.expiresAtIso)
            }
            ui.message?.let { Text(it, color = Color.Yellow, fontSize = 16.sp) }
        }
    }
}

@Composable
private fun CountdownText(expiresAtIso: String?) {
    if (expiresAtIso == null) return
    var remaining by remember(expiresAtIso) {
        mutableIntStateOf(
            ((java.time.Instant.parse(expiresAtIso).toEpochMilli() - System.currentTimeMillis()) / 1000)
                .toInt().coerceAtLeast(0)
        )
    }
    LaunchedEffect(expiresAtIso) {
        while (remaining > 0) {
            delay(1000)
            remaining -= 1
        }
    }
    Text(
        text = if (remaining > 0) "Code expires in $remaining s" else "Refreshing…",
        color = Color.Gray,
        fontSize = 14.sp,
    )
}
