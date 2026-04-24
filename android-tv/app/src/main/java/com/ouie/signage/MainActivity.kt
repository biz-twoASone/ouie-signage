// android-tv/app/src/main/java/com/ouie/signage/MainActivity.kt
package com.ouie.signage

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.KeyEvent
import android.view.WindowManager
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
import androidx.core.content.ContextCompat
import com.ouie.signage.auth.TokenSource
import com.ouie.signage.coordinator.RunningCoordinator
import com.ouie.signage.error.ErrorScreen
import com.ouie.signage.pairing.PairingScreen
import com.ouie.signage.running.RunningScreen
import com.ouie.signage.service.SignageService
import com.ouie.signage.state.AppState
import com.ouie.signage.state.AppStateHolder
import org.koin.android.ext.android.inject

class MainActivity : ComponentActivity() {

    private val appState: AppStateHolder by inject()
    private val tokenStore: TokenSource by inject()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        tokenStore.loadSync()?.let { appState.toRunning(it.deviceId) }
        setContent { SignageRoot(appState) }
    }

    /**
     * Operator escape hatch. With MainActivity now registered as the device HOME
     * app (Plan 4.1), the regular launcher is hidden — operators cannot navigate
     * to Settings/Play Store/Wi-Fi via remote. 5-second hold on OK (DPAD_CENTER)
     * opens the system Settings app. 5s is long enough that no customer could
     * trigger it accidentally while fiddling with the remote.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER &&
            event.action == KeyEvent.ACTION_DOWN &&
            event.repeatCount > 0 &&
            event.eventTime - event.downTime >= 5_000L
        ) {
            runCatching {
                startActivity(
                    Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }
}

@Composable
private fun SignageRoot(appState: AppStateHolder) {
    val state by appState.state.collectAsState()
    val context = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(state) {
        when (state) {
            is AppState.Running -> ContextCompat.startForegroundService(
                context,
                Intent(context, SignageService::class.java),
            )
            else -> context.stopService(Intent(context, SignageService::class.java))
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
