// android-tv/app/src/test/java/com/ouie/signage/heartbeat/HeartbeatSchedulerFirstBootTest.kt
// Plan 5 Phase 3 Task 21 — TDD.
// Drives `maybeForceFcmRefresh()` in isolation — verifies the firstAfterBoot
// state machine without standing up the heartbeat-loop coroutine.
package com.ouie.signage.heartbeat

import com.ouie.signage.errorbus.ErrorBus
import com.ouie.signage.fcm.FcmReceiptTracker
import com.ouie.signage.fcm.FcmTokenSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import org.junit.Assert.assertEquals
import org.junit.Test

class HeartbeatSchedulerFirstBootTest {

    private class CountingTokenSource(scope: CoroutineScope) : FcmTokenSource(scope) {
        var forceRefreshCalls = 0
        override suspend fun forceRefresh() { forceRefreshCalls++ }
    }

    private fun newScheduler(tokenSource: FcmTokenSource): HeartbeatScheduler =
        HeartbeatScheduler(
            scope = CoroutineScope(Dispatchers.Unconfined),
            api = StubHeartbeatApi,
            configRepo = StubConfigRepository,
            skewTracker = ClockSkewTracker(),
            playlistSource = { null },
            pickProvider = { null },
            errorBus = ErrorBus(),
            fcmTokenSource = tokenSource,
            preloadStatusSource = StubPreloadStatusSource,
            fcmReceiptTracker = FcmReceiptTracker(),
            playbackStateSource = StubPlaybackStateSource,
            intervalMs = 60_000,
        )

    @Test fun `maybeForceFcmRefresh calls forceRefresh on first invocation only`() = runBlocking {
        val tokenScope = TestScope(UnconfinedTestDispatcher())
        val tokenSource = CountingTokenSource(tokenScope)
        val sched = newScheduler(tokenSource)

        sched.maybeForceFcmRefresh()
        sched.maybeForceFcmRefresh()
        sched.maybeForceFcmRefresh()

        assertEquals(1, tokenSource.forceRefreshCalls)
    }

    @Test fun `maybeForceFcmRefresh swallows forceRefresh failures`() = runBlocking {
        val tokenScope = TestScope(UnconfinedTestDispatcher())
        val throwing = object : FcmTokenSource(tokenScope) {
            override suspend fun forceRefresh() { throw RuntimeException("gms angry") }
        }
        val sched = newScheduler(throwing)
        // Should not propagate. If swallowed, return is normal; otherwise junit
        // reports the RuntimeException as the failure cause.
        sched.maybeForceFcmRefresh()
    }
}
