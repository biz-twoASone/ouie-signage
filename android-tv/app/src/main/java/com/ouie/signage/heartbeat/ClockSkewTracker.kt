// android-tv/app/src/main/java/com/ouie/signage/heartbeat/ClockSkewTracker.kt
package com.ouie.signage.heartbeat

import java.time.Clock
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/**
 * Per-process singleton. Every HTTP response flows through
 * `DateHeaderInterceptor`, which hands the `Date:` header to `record()`.
 * `current()` returns (server-time − device-time) in seconds — positive means
 * the server is ahead of us. `HeartbeatScheduler` reads this on every tick.
 *
 * Skipping Prometheus / running averages is intentional: we only need the most
 * recent observation so the dashboard sees fresh data, and if the device clock
 * jumps we want the next heartbeat to reflect the jump immediately.
 */
class ClockSkewTracker(private val clock: Clock = Clock.systemUTC()) {

    @Volatile private var lastSkewSeconds: Int? = null

    fun record(rfc1123Date: String) {
        try {
            val serverInstant = ZonedDateTime
                .parse(rfc1123Date, DateTimeFormatter.RFC_1123_DATE_TIME)
                .toInstant()
            val deviceInstant = clock.instant()
            lastSkewSeconds = (serverInstant.epochSecond - deviceInstant.epochSecond).toInt()
        } catch (_: Throwable) {
            // Parse failure — keep the previous value.
        }
    }

    fun current(): Int? = lastSkewSeconds
}
