package com.ouie.signage.net

import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

interface PairingApi {
    @POST("pairing-request")
    suspend fun requestCode(@Body body: PairingRequestBody): PairingRequestResponse

    @GET("pairing-status")
    suspend fun status(@Query("code") code: String): Response<PairingStatusResponse>
}

@Serializable
data class PairingRequestBody(val device_proposed_name: String? = null)

@Serializable
data class PairingRequestResponse(val code: String, val expires_at: String)

/**
 * The server uses a single endpoint with a `status` discriminator:
 *  - "pending"                → keep polling
 *  - "expired"                → request a new code
 *  - "paired"                 → first read after claim: pickup bundle present
 *  - "paired_pickup_consumed" → we (or a stale poller) already drained the pickup
 *                                — if we see this without having persisted tokens,
 *                                we must re-pair.
 */
@Serializable
data class PairingStatusResponse(
    val status: String,
    val device_id: String? = null,
    val access_token: String? = null,
    val refresh_token: String? = null,
    val expires_in: Int? = null,
)
