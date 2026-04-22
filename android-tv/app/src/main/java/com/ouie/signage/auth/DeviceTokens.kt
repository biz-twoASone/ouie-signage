package com.ouie.signage.auth

import kotlinx.serialization.Serializable

@Serializable
data class DeviceTokens(
    val accessToken: String,
    val refreshToken: String,
    val deviceId: String,
    val expiresInSeconds: Int,
)
