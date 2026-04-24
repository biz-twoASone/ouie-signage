// android-tv/app/src/test/java/com/ouie/signage/heartbeat/HeartbeatSchedulerStubs.kt
// Plan 5 Phase 3 Task 21 — minimal stubs so HeartbeatScheduler can be
// instantiated for narrow unit tests without standing up the real ConfigApi /
// ConfigStore / PlaybackDirector / HeartbeatApi graph. The stubs throw on
// every method that's not exercised by these tests, so accidental coverage
// expansion fails loudly.
package com.ouie.signage.heartbeat

import com.ouie.signage.config.ConfigDto
import com.ouie.signage.config.ConfigRepository
import com.ouie.signage.config.ConfigStore
import com.ouie.signage.net.ConfigApi
import com.ouie.signage.net.HeartbeatApi
import com.ouie.signage.playback.PlaybackStateSnapshot
import com.ouie.signage.playback.PlaybackStateSource
import com.ouie.signage.preload.PreloadStatus
import com.ouie.signage.preload.PreloadStatusSource
import kotlinx.serialization.json.Json
import retrofit2.Response
import java.io.File

internal object StubHeartbeatApi : HeartbeatApi {
    override suspend fun post(body: HeartbeatPayload): Response<Unit> {
        throw UnsupportedOperationException("stub: HeartbeatApi.post not exercised by these tests")
    }
}

internal object StubPlaybackStateSource : PlaybackStateSource {
    override fun snapshot(): PlaybackStateSnapshot = PlaybackStateSnapshot(null, "no_content")
}

internal object StubPreloadStatusSource : PreloadStatusSource {
    override fun current(): PreloadStatus? = null
}

internal object StubConfigApi : ConfigApi {
    override suspend fun fetch(ifNoneMatch: String?): Response<ConfigDto> {
        throw UnsupportedOperationException("stub: ConfigApi.fetch not exercised by these tests")
    }
}

internal val StubConfigRepository: ConfigRepository =
    ConfigRepository(
        api = StubConfigApi,
        store = ConfigStore(
            File(System.getProperty("java.io.tmpdir"), "stub-config-${System.nanoTime()}"),
            Json,
        ),
    )
