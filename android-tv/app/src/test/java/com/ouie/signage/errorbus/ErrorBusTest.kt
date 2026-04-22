// android-tv/app/src/test/java/com/ouie/signage/errorbus/ErrorBusTest.kt
package com.ouie.signage.errorbus

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.util.concurrent.Executors

class ErrorBusTest {

    @Test
    fun `drain returns reported events in insertion order`() {
        val bus = ErrorBus(capacity = 100, clock = { Instant.parse("2026-04-23T00:00:00Z") })
        bus.report(kind = "download_failed", mediaId = "m1", message = "timeout")
        bus.report(kind = "playback_failed", mediaId = "m2", message = "codec")
        val drained = bus.drain()
        assertEquals(2, drained.size)
        assertEquals("download_failed", drained[0].kind)
        assertEquals("m1", drained[0].media_id)
        assertEquals("playback_failed", drained[1].kind)
        assertEquals("2026-04-23T00:00:00Z", drained[0].timestamp)
    }

    @Test
    fun `drain empties the queue`() {
        val bus = ErrorBus(capacity = 100)
        bus.report(kind = "x", mediaId = null, message = "y")
        assertEquals(1, bus.drain().size)
        assertEquals(0, bus.drain().size)
    }

    @Test
    fun `exceeding capacity drops the oldest events`() {
        val bus = ErrorBus(capacity = 3)
        bus.report(kind = "a", mediaId = null, message = null)
        bus.report(kind = "b", mediaId = null, message = null)
        bus.report(kind = "c", mediaId = null, message = null)
        bus.report(kind = "d", mediaId = null, message = null)
        val drained = bus.drain()
        assertEquals(3, drained.size)
        assertEquals(listOf("b", "c", "d"), drained.map { it.kind })
    }

    @Test
    fun `concurrent reports from many threads never lose or corrupt events`() {
        val bus = ErrorBus(capacity = 10_000)
        val pool = Executors.newFixedThreadPool(8)
        val total = 1_000
        val latch = java.util.concurrent.CountDownLatch(total)
        repeat(total) { i ->
            pool.submit {
                bus.report(kind = "k", mediaId = "m$i", message = null)
                latch.countDown()
            }
        }
        latch.await()
        pool.shutdown()
        assertEquals(total, bus.drain().size)
    }
}
