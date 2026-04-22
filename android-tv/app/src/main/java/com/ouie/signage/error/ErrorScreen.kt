package com.ouie.signage.error

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.tv.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ouie.signage.state.AppState
import kotlinx.coroutines.delay

@Composable
fun ErrorScreen(kind: AppState.ErrorKind, onRetry: () -> Unit) {
    val (title, detail, autoRetrySec) = when (kind) {
        AppState.ErrorKind.NetworkUnavailable ->
            Triple("No network", "Retrying automatically when the TV reconnects.", 10)
        AppState.ErrorKind.ServerUnavailable ->
            Triple("Can't reach our server", "Will retry shortly.", 10)
        AppState.ErrorKind.TokensInvalid ->
            Triple("Device needs re-pairing", "Starting pairing again…", 3)
        AppState.ErrorKind.Unknown ->
            Triple("Something went wrong", "Retrying shortly.", 10)
    }

    var remaining by remember(kind) { mutableIntStateOf(autoRetrySec) }
    LaunchedEffect(kind) {
        while (remaining > 0) {
            delay(1_000)
            remaining -= 1
        }
        onRetry()
    }

    Box(Modifier.fillMaxSize().background(Color.Black).padding(48.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(title, color = Color.White, fontSize = 28.sp)
            Text(detail, color = Color.Gray, fontSize = 18.sp)
            Text("Retrying in $remaining s", color = Color.Gray, fontSize = 14.sp)
        }
    }
}
