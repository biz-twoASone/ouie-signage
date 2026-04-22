// android-tv/app/src/test/java/com/ouie/signage/heartbeat/ClockSkewTrackerTest.kt
package com.ouie.signage.heartbeat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class ClockSkewTrackerTest {

    // Pin "device now" to a known instant so we can test deterministic skew
    private val deviceNow = Instant.parse("2026-04-23T10:00:00Z")
    private val fixedClock = Clock.fixed(deviceNow, ZoneOffset.UTC)

    @Test
    fun `server ahead by 5 seconds yields skew=-5 on device`() {
        val tracker = ClockSkewTracker(fixedClock)
        // RFC 1123 format — what HTTP Date headers look like
        tracker.record("Thu, 23 Apr 2026 10:00:05 GMT")
        // Convention: skew is (server - device). Positive = server ahead.
        assertEquals(5, tracker.current())
    }

    @Test
    fun `server behind by 3 seconds yields skew=-3`() {
        val tracker = ClockSkewTracker(fixedClock)
        tracker.record("Thu, 23 Apr 2026 09:59:57 GMT")
        assertEquals(-3, tracker.current())
    }

    @Test
    fun `no record yields null until first observation`() {
        val tracker = ClockSkewTracker(fixedClock)
        assertNull(tracker.current())
    }

    @Test
    fun `malformed date does not throw and does not overwrite prior value`() {
        val tracker = ClockSkewTracker(fixedClock)
        tracker.record("Thu, 23 Apr 2026 10:00:05 GMT")
        tracker.record("not a date")
        assertEquals(5, tracker.current())
    }
}
