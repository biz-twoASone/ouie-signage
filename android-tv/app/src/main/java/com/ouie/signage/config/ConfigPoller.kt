// android-tv/app/src/main/java/com/ouie/signage/config/ConfigPoller.kt
package com.ouie.signage.config

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Runs ConfigRepository.fetch() every [intervalMs], with exponential backoff on
 * Error (1, 2, 4, 8, capped at interval). Idempotent start/stop; called by
 * RunningCoordinator.
 *
 * Backoff reasoning (spec §7): transient network / 5xx should NOT hammer the
 * server or drain the device's connection. We max-out at the same interval we
 * normally poll at — the fallback path's floor is "one poll per minute", which
 * the dashboard already tolerates.
 */
class ConfigPoller(
    private val scope: CoroutineScope,
    private val repo: ConfigRepository,
    private val intervalMs: Long = 60_000,
) {

    private var job: Job? = null

    fun start() {
        if (job?.isActive == true) return
        job = scope.launch {
            var backoff = 1_000L
            while (true) {
                val result = repo.fetch()
                try {
                    when (result) {
                        is ConfigRepository.Result.Applied,
                        ConfigRepository.Result.NotModified -> {
                            backoff = 1_000L
                            delay(intervalMs)
                        }
                        is ConfigRepository.Result.Error -> {
                            delay(backoff)
                            backoff = (backoff * 2).coerceAtMost(intervalMs)
                        }
                    }
                } catch (e: CancellationException) {
                    throw e
                }
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }
}
