// android-tv/app/src/main/java/com/ouie/signage/net/CacheStatusApi.kt
package com.ouie.signage.net

import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

interface CacheStatusApi {
    @POST("devices-cache-status")
    suspend fun post(@Body body: CacheStatusBatch): Response<Unit>
}

@Serializable
data class CacheStatusBatch(val events: List<CacheStatusEvent>)

@Serializable
data class CacheStatusEvent(
    /** "cached" | "failed" | "evicted" | "preloaded" — spec §4 `cache_events.state` CHECK */
    val state: String,
    val media_id: String? = null,
    val message: String? = null,
)
