// android-tv/app/src/main/java/com/ouie/signage/auth/TokenSource.kt
package com.ouie.signage.auth

/**
 * Read/write interface over token persistence. Production: TokenStore (EncryptedSharedPreferences).
 * Test: FakeTokenStore (in-memory).
 */
interface TokenSource {
    fun loadSync(): DeviceTokens?
    fun save(tokens: DeviceTokens)
    fun clear()
}
