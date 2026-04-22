// android-tv/app/src/main/java/com/ouie/signage/net/RetrofitRefreshAdapter.kt
package com.ouie.signage.net

import com.ouie.signage.auth.DeviceTokens

class RetrofitRefreshAdapter(
    private val deviceApi: DeviceApi,
) : RefreshAdapter {
    override suspend fun refresh(current: DeviceTokens): DeviceTokens {
        val resp = deviceApi.refresh(RefreshBody(refresh_token = current.refreshToken))
        if (!resp.isSuccessful) throw RefreshFailedException(resp.code())
        val body = resp.body() ?: throw RefreshFailedException(-1)
        return DeviceTokens(
            accessToken = body.access_token,
            refreshToken = body.refresh_token,
            deviceId = current.deviceId,                  // server doesn't echo this
            expiresInSeconds = body.expires_in,
        )
    }
}

class RefreshFailedException(val httpCode: Int) : Exception("refresh failed: $httpCode")
