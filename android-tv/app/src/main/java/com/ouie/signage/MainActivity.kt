// android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt
package com.ouie.signage

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.ouie.signage.auth.TokenSource
import com.ouie.signage.error.ErrorScreen
import com.ouie.signage.pairing.PairingScreen
import com.ouie.signage.running.RunningScreen
import com.ouie.signage.state.AppState
import com.ouie.signage.state.AppStateHolder
import org.koin.android.ext.android.inject

class MainActivity : ComponentActivity() {

    private val appState: AppStateHolder by inject()
    private val tokenStore: TokenSource by inject()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Cold-start recovery: if tokens are already persisted, go directly to Running.
        // Refresh on the first authed call (3b) will validate them; if invalid, the
        // Authenticator clears them and AppState flips back to Pairing.
        tokenStore.loadSync()?.let { appState.toRunning(it.deviceId) }

        setContent { SignageRoot(appState) }
    }
}

@Composable
private fun SignageRoot(appState: AppStateHolder) {
    val state by appState.state.collectAsState()
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
