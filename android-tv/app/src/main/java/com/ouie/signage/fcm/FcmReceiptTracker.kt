// android-tv/app/src/main/java/com/ouie/signage/fcm/FcmReceiptTracker.kt
package com.ouie.signage.fcm

import java.time.Instant

/**
 * Records the timestamp of the last FCM message we received. Written by
 * SignageMessagingService.onMessageReceived; read by HeartbeatScheduler.
 * Volatile single-var state — no buffering (we only care about the latest).
 *
 * Survives until process death. On process restart, starts as null until the
 * next push arrives.
 */
class FcmReceiptTracker {
    @Volatile private var lastAt: Instant? = null
    fun mark() { lastAt = Instant.now() }
    fun current(): Instant? = lastAt
}
