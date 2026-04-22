// android-tv/app/src/main/java/com/ouie/signage/errorbus/ErrorBus.kt
package com.ouie.signage.errorbus

import java.time.Clock
import java.time.Instant
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Thread-safe bounded FIFO of error events. When the queue is full, the oldest
 * event is dropped to make room for the newest — matches operator intuition
 * ("tell me what just went wrong, not what failed an hour ago").
 *
 * `drain()` atomically empties the queue. Meant to be called once per heartbeat
 * tick so events between ticks are shipped, then reset.
 */
class ErrorBus(
    private val capacity: Int = 32,
    private val clock: () -> Instant = { Instant.now(Clock.systemUTC()) },
) {

    private val lock = ReentrantLock()
    private val buffer = ArrayDeque<ErrorEvent>(capacity)

    fun report(kind: String, mediaId: String?, message: String?) {
        lock.withLock {
            if (buffer.size >= capacity) buffer.removeFirst()
            buffer.addLast(
                ErrorEvent(
                    timestamp = clock().toString(),
                    kind = kind,
                    media_id = mediaId,
                    message = message?.take(500),
                ),
            )
        }
    }

    fun drain(): List<ErrorEvent> = lock.withLock {
        val snapshot = buffer.toList()
        buffer.clear()
        snapshot
    }
}
