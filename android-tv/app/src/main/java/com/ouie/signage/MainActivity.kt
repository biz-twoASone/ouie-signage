// android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt
package com.ouie.signage

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.ouie.signage.auth.TokenSource
import com.ouie.signage.coordinator.RunningCoordinator
import com.ouie.signage.error.ErrorScreen
import com.ouie.signage.pairing.PairingScreen
import com.ouie.signage.running.RunningScreen
import com.ouie.signage.state.AppState
import com.ouie.signage.state.AppStateHolder
import org.koin.android.ext.android.inject

class MainActivity : ComponentActivity() {

    private val appState: AppStateHolder by inject()
    private val tokenStore: TokenSource by inject()
    private val coordinator: RunningCoordinator by inject()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Cold-start recovery from 3a: if tokens exist, go straight to Running.
        // Coordinator will start below when AppState emits Running.
        tokenStore.loadSync()?.let { appState.toRunning(it.deviceId) }

        setContent { SignageRoot(appState, coordinator) }
    }

    override fun onDestroy() {
        super.onDestroy()
        // Activity going away — stop loops. On configuration change Android will
        // re-create the activity; coordinator.start() is idempotent on the next
        // Running emission.
        coordinator.stop()
    }
}

@Composable
private fun SignageRoot(appState: AppStateHolder, coordinator: RunningCoordinator) {
    val state by appState.state.collectAsState()
    LaunchedEffect(state) {
        // Tie coordinator lifecycle to AppState.Running. If we ever enter Pairing
        // or Error, stop the loops so we don't hammer the server with a revoked
        // token.
        when (state) {
            is AppState.Running -> coordinator.start()
            else -> coordinator.stop()
        }
    }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        when (val s = state) {
            AppState.Pairing -> PairingScreen()
            is AppState.Running -> RunningScreen(deviceId = s.deviceId)
            is AppState.Error -> ErrorScreen(
                kind = s.kind,
                onRetry = { appState.recoverToPairing() },
            )
        }
    }
}
