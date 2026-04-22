// android-tv/app/src/main/java/com/ouie/signage/net/HeartbeatApi.kt
package com.ouie.signage.net

import com.ouie.signage.heartbeat.HeartbeatPayload
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

interface HeartbeatApi {
    /**
     * POST `/devices-heartbeat`. Server returns 204 on success. We keep Response<Unit>
     * rather than a suspend Unit so callers can inspect `.code()` if we ever want
     * to differentiate 204 from rare 400 responses without exception handling.
     */
    @POST("devices-heartbeat")
    suspend fun post(@Body body: HeartbeatPayload): Response<Unit>
}
