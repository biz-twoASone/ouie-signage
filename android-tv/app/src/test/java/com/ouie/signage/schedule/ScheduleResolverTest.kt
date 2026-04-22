// android-tv/app/src/test/java/com/ouie/signage/schedule/ScheduleResolverTest.kt
package com.ouie.signage.schedule

import com.ouie.signage.config.DeviceDto
import com.ouie.signage.config.RuleDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Clock
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

class ScheduleResolverTest {

    private val jkt = ZoneId.of("Asia/Jakarta")
    private val device = DeviceDto(
        id = "dev-1",
        store_id = "store-1",
        fallback_playlist_id = "fallback",
        timezone = "Asia/Jakarta",
    )

    // Fixed "Monday 10:30 local Jakarta" for all tests
    private val mondayMorning: ZonedDateTime =
        ZonedDateTime.of(LocalDate.of(2026, 5, 4), LocalTime.of(10, 30), jkt)

    @Test
    fun `no rules returns fallback`() {
        val picked = ScheduleResolver.resolve(
            device = device,
            rules = emptyList(),
            nowLocal = mondayMorning,
        )
        assertEquals("fallback", picked)
    }

    @Test
    fun `no rules, no fallback returns null`() {
        val picked = ScheduleResolver.resolve(
            device = device.copy(fallback_playlist_id = null),
            rules = emptyList(),
            nowLocal = mondayMorning,
        )
        assertNull(picked)
    }

    @Test
    fun `group-targeted rule in payload beats fallback (server pre-filtered by scope)`() {
        val picked = ScheduleResolver.resolve(
            device = device,
            rules = listOf(
                RuleDto(
                    id = "r-1",
                    playlist_id = "p-morning",
                    target_device_group_id = "g-1",
                    days_of_week = listOf(1, 2, 3, 4, 5),
                    start_time = "09:00:00",
                    end_time = "12:00:00",
                    effective_at = "2026-04-01T00:00:00Z",
                ),
            ),
            nowLocal = mondayMorning,
        )
        assertEquals("p-morning", picked)
    }

    @Test
    fun `device-specific rule beats group rule even when newer group rule exists`() {
        val picked = ScheduleResolver.resolve(
            device = device,
            rules = listOf(
                RuleDto(
                    id = "r-group",
                    playlist_id = "p-group",
                    target_device_group_id = "g-1",
                    days_of_week = listOf(1),
                    start_time = "09:00:00", end_time = "12:00:00",
                    effective_at = "2026-04-22T00:00:00Z",    // newer
                ),
                RuleDto(
                    id = "r-dev",
                    playlist_id = "p-device",
                    target_device_id = "dev-1",
                    days_of_week = listOf(1),
                    start_time = "09:00:00", end_time = "12:00:00",
                    effective_at = "2026-04-01T00:00:00Z",    // older
                ),
            ),
            nowLocal = mondayMorning,
        )
        assertEquals("p-device", picked)
    }

    @Test
    fun `within a scope the newer effective_at wins`() {
        val picked = ScheduleResolver.resolve(
            device = device,
            rules = listOf(
                RuleDto(
                    id = "r-old",
                    playlist_id = "p-old",
                    target_device_group_id = "g-1",
                    days_of_week = listOf(1),
                    start_time = "09:00:00", end_time = "12:00:00",
                    effective_at = "2026-04-01T00:00:00Z",
                ),
                RuleDto(
                    id = "r-new",
                    playlist_id = "p-new",
                    target_device_group_id = "g-1",
                    days_of_week = listOf(1),
                    start_time = "09:00:00", end_time = "12:00:00",
                    effective_at = "2026-04-15T00:00:00Z",
                ),
            ),
            nowLocal = mondayMorning,
        )
        assertEquals("p-new", picked)
    }

    @Test
    fun `weekday outside days_of_week is skipped`() {
        val sunday = ZonedDateTime.of(LocalDate.of(2026, 5, 3), LocalTime.of(10, 30), jkt)
        val picked = ScheduleResolver.resolve(
            device = device,
            rules = listOf(
                RuleDto(
                    id = "r",
                    playlist_id = "p-weekday-only",
                    target_device_id = "dev-1",
                    days_of_week = listOf(1, 2, 3, 4, 5),
                    start_time = "09:00:00", end_time = "12:00:00",
                    effective_at = "2026-04-01T00:00:00Z",
                ),
            ),
            nowLocal = sunday,
        )
        assertEquals("fallback", picked)
    }

    @Test
    fun `time outside start_time and end_time is skipped`() {
        val picked = ScheduleResolver.resolve(
            device = device,
            rules = listOf(
                RuleDto(
                    id = "r",
                    playlist_id = "p-after-hours",
                    target_device_id = "dev-1",
                    days_of_week = listOf(1),
                    start_time = "18:00:00",
                    end_time = "22:00:00",
                    effective_at = "2026-04-01T00:00:00Z",
                ),
            ),
            nowLocal = mondayMorning,
        )
        assertEquals("fallback", picked)
    }
}
