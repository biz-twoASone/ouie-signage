// android-tv/app/src/test/java/com/ouie/signage/schedule/SyncWindowTest.kt
package com.ouie.signage.schedule

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalTime

class SyncWindowTest {

    @Test
    fun `normal window — inside returns true, outside returns false`() {
        val start = LocalTime.of(2, 0)
        val end = LocalTime.of(5, 0)
        assertEquals(true,  SyncWindow.isWithin(start, end, LocalTime.of(3, 0)))
        assertEquals(true,  SyncWindow.isWithin(start, end, LocalTime.of(2, 0)))  // start inclusive
        assertEquals(false, SyncWindow.isWithin(start, end, LocalTime.of(5, 0)))  // end exclusive
        assertEquals(false, SyncWindow.isWithin(start, end, LocalTime.of(1, 59)))
        assertEquals(false, SyncWindow.isWithin(start, end, LocalTime.of(5, 1)))
    }

    @Test
    fun `midnight-crossing window — 22 to 04 behaves correctly`() {
        val start = LocalTime.of(22, 0)
        val end = LocalTime.of(4, 0)
        assertEquals(true,  SyncWindow.isWithin(start, end, LocalTime.of(23, 0)))
        assertEquals(true,  SyncWindow.isWithin(start, end, LocalTime.of(0, 30)))
        assertEquals(true,  SyncWindow.isWithin(start, end, LocalTime.of(3, 59)))
        assertEquals(false, SyncWindow.isWithin(start, end, LocalTime.of(4, 0)))   // end exclusive
        assertEquals(false, SyncWindow.isWithin(start, end, LocalTime.of(21, 59)))
        assertEquals(false, SyncWindow.isWithin(start, end, LocalTime.of(12, 0)))
    }

    @Test
    fun `equal start and end is an empty window`() {
        val t = LocalTime.of(3, 0)
        assertEquals(false, SyncWindow.isWithin(t, t, LocalTime.of(3, 0)))
    }
}
