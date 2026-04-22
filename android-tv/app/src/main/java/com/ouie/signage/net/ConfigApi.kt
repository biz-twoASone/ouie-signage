// android-tv/app/src/main/java/com/ouie/signage/net/ConfigApi.kt
package com.ouie.signage.net

import com.ouie.signage.config.ConfigDto
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Header

interface ConfigApi {

    /**
     * Returns 200 with the full body when the device's last known ETag is
     * stale (or missing), or 304 with no body when it's current. Pass null
     * as `ifNoneMatch` on the first call.
     *
     * Retrofit typechecks `Response<ConfigDto>` so the caller can inspect
     * `.code()` for the 304 path without going through exception flow.
     */
    @GET("devices-config")
    suspend fun fetch(
        @Header("If-None-Match") ifNoneMatch: String? = null,
    ): Response<ConfigDto>
}
