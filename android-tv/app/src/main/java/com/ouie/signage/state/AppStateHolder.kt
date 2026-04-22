package com.ouie.signage.state

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Single source of truth for the UI state of the app. MainActivity observes
 * `state` and renders the appropriate Compose screen; repositories emit into
 * it via the transition methods.
 */
class AppStateHolder {
    private val _state = MutableStateFlow<AppState>(AppState.Pairing)
    val state: StateFlow<AppState> = _state.asStateFlow()

    fun toRunning(deviceId: String) {
        _state.value = AppState.Running(deviceId)
    }

    fun toError(kind: AppState.ErrorKind) {
        _state.value = AppState.Error(kind)
    }

    fun recoverToPairing() {
        _state.value = AppState.Pairing
    }
}
