package com.ouie.signage.fcm

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Single app-wide pub/sub for "sync immediately". `SignageMessagingService`
 * emits via `fire()`; `RunningCoordinator` collects via `events` and runs the
 * sync cycle on receipt. Koin single, so the service side and coordinator side
 * share the same instance.
 *
 * extraBufferCapacity=1 + onBufferOverflow=DROP_OLDEST — if 100 messages come
 * in while we're offline, we don't want to sync 100 times on reconnect; one
 * coalesced sync is enough.
 */
class SyncNowBroadcast {
    private val _events = MutableSharedFlow<Unit>(
        replay = 0,
        extraBufferCapacity = 1,
        onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST,
    )
    val events: SharedFlow<Unit> = _events.asSharedFlow()

    fun fire() { _events.tryEmit(Unit) }
}
