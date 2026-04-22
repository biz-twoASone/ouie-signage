// android-tv/app/src/main/java/com/ouie/signage/pairing/PairingViewModel.kt
package com.ouie.signage.pairing

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ouie.signage.auth.TokenSource
import com.ouie.signage.state.AppState
import com.ouie.signage.state.AppStateHolder
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Drives the Pairing screen:
 * 1. On init, request a code.
 * 2. Start polling `/pairing-status` every 3s.
 * 3. On Paired: persist tokens, transition AppState to Running.
 * 4. On Expired / PickupConsumed: request a new code and restart polling.
 * 5. On Error: surface via AppState.Error; auto-retry from ErrorScreen.
 */
class PairingViewModel(
    private val repo: PairingRepository,
    private val tokenStore: TokenSource,
    private val appState: AppStateHolder,
) : ViewModel() {

    data class UiState(
        val code: String? = null,
        val expiresAtIso: String? = null,
        val secondsUntilExpiry: Int = 0,
        val isRequesting: Boolean = true,
        val message: String? = null,
    )

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    init {
        start()
    }

    private fun start() {
        viewModelScope.launch {
            loop()
        }
    }

    private suspend fun loop() {
        while (true) {
            _ui.value = UiState(isRequesting = true)
            val code = try {
                repo.requestCode()
            } catch (e: CancellationException) {
                throw e
            } catch (t: Throwable) {
                appState.toError(AppState.ErrorKind.ServerUnavailable)
                return
            }
            _ui.value = UiState(
                code = code.code,
                expiresAtIso = code.expiresAtIso,
                secondsUntilExpiry = secondsUntil(code.expiresAtIso),
                isRequesting = false,
            )

            when (val result = repo.observeClaim(code.code)) {
                is PairingRepository.ClaimResult.Paired -> {
                    tokenStore.save(result.tokens)
                    appState.toRunning(result.tokens.deviceId)
                    return
                }
                PairingRepository.ClaimResult.Expired,
                PairingRepository.ClaimResult.PickupConsumed -> {
                    _ui.value = _ui.value.copy(message = "Code expired — generating a new one…")
                    // loop — request a new code
                }
                is PairingRepository.ClaimResult.Error -> {
                    appState.toError(AppState.ErrorKind.NetworkUnavailable)
                    return
                }
                PairingRepository.ClaimResult.Pending -> {} // observeClaim never returns Pending
            }
        }
    }

    private fun secondsUntil(iso: String): Int =
        ((Instant.parse(iso).toEpochMilli() - System.currentTimeMillis()) / 1000).toInt()
            .coerceAtLeast(0)
}
