package com.ouie.signage.state

import app.cash.turbine.test
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class AppStateHolderTest {
    @Test
    fun `initial state is Pairing`() = runTest {
        val holder = AppStateHolder()
        holder.state.test {
            assertEquals(AppState.Pairing, awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `transition to Running emits new state`() = runTest {
        val holder = AppStateHolder()
        holder.toRunning(deviceId = "dev-1")
        holder.state.test {
            val first = awaitItem()
            assertEquals(AppState.Running(deviceId = "dev-1"), first)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `transition to Error emits with kind`() = runTest {
        val holder = AppStateHolder()
        holder.toError(AppState.ErrorKind.NetworkUnavailable)
        holder.state.test {
            val first = awaitItem()
            assertEquals(AppState.Error(AppState.ErrorKind.NetworkUnavailable), first)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `recoverToPairing from Error resets`() = runTest {
        val holder = AppStateHolder()
        holder.toError(AppState.ErrorKind.TokensInvalid)
        holder.recoverToPairing()
        holder.state.test {
            assertEquals(AppState.Pairing, awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }
}
