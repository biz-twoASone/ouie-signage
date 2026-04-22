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

    /**
     * NOTE: Does NOT clear persisted tokens. If a caller is recovering from [AppState.ErrorKind.TokensInvalid],
     * tokens must be cleared separately (e.g., via `TokenStore.clear()`) — otherwise cold-start will reload
     * the stale tokens and re-enter `Running`, causing a 401→refresh→TokensInvalid loop.
     * Today, [com.ouie.signage.net.TokenAuthenticator] clears tokens inside its refresh-failure path,
     * so the `TokensInvalid` path already comes in token-free. Plan 3b callers that emit `TokensInvalid`
     * directly must uphold that invariant themselves.
     */
    fun recoverToPairing() {
        _state.value = AppState.Pairing
    }
}
