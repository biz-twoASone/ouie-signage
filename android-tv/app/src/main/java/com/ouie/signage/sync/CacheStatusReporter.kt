// android-tv/app/src/main/java/com/ouie/signage/sync/CacheStatusReporter.kt
package com.ouie.signage.sync

import com.ouie.signage.net.CacheStatusApi
import com.ouie.signage.net.CacheStatusBatch
import com.ouie.signage.net.CacheStatusEvent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Batches cache events, flushes to devices-cache-status either when the queue
 * has `maxBatchSize` events or every `flushIntervalMs`. The coroutine is tied
 * to the Coordinator's scope.
 *
 * Non-retrying on purpose: cache events are diagnostic, not billable. If a
 * batch fails to upload, next batch carries the fresh events; the missing
 * ones are logged locally via the debug HTTP interceptor.
 */
class CacheStatusReporter(
    private val scope: CoroutineScope,
    private val api: CacheStatusApi,
    private val flushIntervalMs: Long = 10_000,
    private val maxBatchSize: Int = 20,
) {

    private val inbox = Channel<CacheStatusEvent>(capacity = 128)
    private var job: Job? = null

    fun start() {
        if (job?.isActive == true) return
        job = scope.launch {
            val pending = mutableListOf<CacheStatusEvent>()
            var lastFlush = System.currentTimeMillis()
            while (isActive) {
                // Drain whatever's queued without blocking
                while (true) {
                    val item = inbox.tryReceive().getOrNull() ?: break
                    pending += item
                }
                val shouldFlushBySize = pending.size >= maxBatchSize
                val shouldFlushByTime = pending.isNotEmpty() &&
                    System.currentTimeMillis() - lastFlush >= flushIntervalMs
                if (shouldFlushBySize || shouldFlushByTime) {
                    val batch = pending.toList()
                    pending.clear()
                    try {
                        api.post(CacheStatusBatch(batch))
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Throwable) {
                        // Drop; next batch will include new events.
                    }
                    lastFlush = System.currentTimeMillis()
                }
                try { delay(500) } catch (e: CancellationException) { throw e }
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    fun report(event: CacheStatusEvent) {
        // `trySend` drops when the channel is full — we don't care; events are
        // informational only.
        inbox.trySend(event)
    }

    fun cached(mediaId: String)          = report(CacheStatusEvent(state = "cached",   media_id = mediaId))
    fun failed(mediaId: String, msg: String) = report(CacheStatusEvent(state = "failed", media_id = mediaId, message = msg))
}
