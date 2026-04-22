package com.ouie.signage.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Persists device tokens in EncryptedSharedPreferences. Access token is kept in
 * memory via the MutableStateFlow; only the refresh_token + device_id survive
 * process death. When MainActivity starts, it reads these back and asks the
 * refresh endpoint for a fresh access token.
 *
 * File name `signage_tokens.xml` is excluded from Android auto-backup via
 * res/xml/backup_rules.xml.
 */
class TokenStore(context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "signage_tokens",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun load(): PersistedTokens? {
        val refresh = prefs.getString(KEY_REFRESH, null) ?: return null
        val deviceId = prefs.getString(KEY_DEVICE_ID, null) ?: return null
        val access = prefs.getString(KEY_ACCESS, null) // may be null (RAM-only in v1)
        return PersistedTokens(refreshToken = refresh, deviceId = deviceId, lastAccessToken = access)
    }

    fun save(tokens: DeviceTokens) {
        prefs.edit()
            .putString(KEY_REFRESH, tokens.refreshToken)
            .putString(KEY_DEVICE_ID, tokens.deviceId)
            .putString(KEY_ACCESS, tokens.accessToken)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    data class PersistedTokens(
        val refreshToken: String,
        val deviceId: String,
        val lastAccessToken: String?,
    )

    private companion object {
        const val KEY_REFRESH = "refresh_token"
        const val KEY_ACCESS = "access_token"
        const val KEY_DEVICE_ID = "device_id"
    }
}
