package com.ouie.signage.state

sealed interface AppState {
    data object Pairing : AppState
    data class Running(val deviceId: String) : AppState
    data class Error(val kind: ErrorKind) : AppState

    enum class ErrorKind {
        NetworkUnavailable,
        ServerUnavailable,
        TokensInvalid,
        Unknown,
    }
}
