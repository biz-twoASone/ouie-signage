// android-tv/app/src/main/java/com/ouie/signage/config/ConfigRepository.kt
package com.ouie.signage.config

import com.ouie.signage.net.ConfigApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Thin wrapper around ConfigApi + ConfigStore. Emits the current config as a
 * StateFlow (seeded from disk on init) so downstream consumers (the schedule
 * resolver, the sync worker) can react to new versions without polling the
 * store.
 *
 * Error policy (spec §7): any non-success response (401 → TokenAuthenticator
 * handles; other 4xx/5xx → `Result.Error`) leaves the stored config untouched.
 * Callers keep playing whatever was last good.
 */
class ConfigRepository(
    private val api: ConfigApi,
    private val store: ConfigStore,
) {

    sealed interface Result {
        data class Applied(val version: String) : Result
        data object NotModified : Result
        data class Error(val cause: Throwable?) : Result
    }

    private val _current = MutableStateFlow(store.loadConfig())
    val current: StateFlow<ConfigDto?> = _current.asStateFlow()

    suspend fun fetch(): Result {
        val resp = try {
            api.fetch(ifNoneMatch = store.loadETag())
        } catch (e: CancellationException) {
            throw e
        } catch (t: Throwable) {
            return Result.Error(t)
        }

        return when (resp.code()) {
            200 -> {
                val body = resp.body() ?: return Result.Error(null)
                store.save(body, resp.headers()["ETag"])
                _current.value = body
                Result.Applied(body.version)
            }
            304 -> Result.NotModified
            else -> Result.Error(RuntimeException("devices-config HTTP ${resp.code()}"))
        }
    }
}
