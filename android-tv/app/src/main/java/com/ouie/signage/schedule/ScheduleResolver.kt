// android-tv/app/src/main/java/com/ouie/signage/schedule/ScheduleResolver.kt
package com.ouie.signage.schedule

import com.ouie.signage.config.DeviceDto
import com.ouie.signage.config.RuleDto
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalTime
import java.time.ZonedDateTime

/**
 * Pure implementation of the precedence rules from spec §4. The server has
 * already filtered out (a) rules whose `effective_at` is in the future AND
 * (b) rules whose scope doesn't apply to this device (`target_device_id = me
 * OR target_device_group_id IN my_groups`). The device only needs to evaluate
 * weekday + time-of-day and apply the device-beats-group + newer-wins
 * precedence for the remaining rules.
 *
 * Precedence (highest first):
 *   1. Rules targeting this device directly (target_device_id != null)
 *   2. Rules targeting one of this device's groups (target_device_group_id != null)
 *   Within each class, rules with a later `effective_at` win (tiebreaker: id asc).
 *
 * Fallback: device.fallback_playlist_id (may be null).
 */
object ScheduleResolver {

    fun resolve(
        device: DeviceDto,
        rules: List<RuleDto>,
        nowLocal: ZonedDateTime,
    ): String? {
        val weekdayIso = nowLocal.dayOfWeek.value   // 1=Mon..7=Sun, matches spec
        val timeOfDay = nowLocal.toLocalTime()

        val applicable = rules
            .asSequence()
            .filter { weekdayIso in it.days_of_week }
            .filter { matchesTimeOfDay(it, timeOfDay) }
            .toList()

        if (applicable.isEmpty()) return device.fallback_playlist_id

        val ranked = applicable.sortedWith(
            compareByDescending<RuleDto> { it.target_device_id != null }
                .thenByDescending { Instant.parse(it.effective_at) }
                .thenBy { it.id },
        )
        return ranked.first().playlist_id
    }

    private fun matchesTimeOfDay(r: RuleDto, now: LocalTime): Boolean {
        // Postgres "time" serializes as HH:MM:SS; LocalTime.parse handles that.
        val start = LocalTime.parse(r.start_time)
        val end = LocalTime.parse(r.end_time)
        // Inclusive start, inclusive end — matches the way operators author rules
        // ("9:00 to 12:00" means 9:00–12:00 inclusive). Picking inclusive on both
        // ends does cause a 1-second overlap if two rules butt against each other
        // (e.g., 09-12 vs 12-18); precedence by effective_at breaks the tie.
        return !now.isBefore(start) && !now.isAfter(end)
    }

    /** Map ISO day-of-week (1=Mon..7=Sun) to `DayOfWeek` for callers that want it. */
    fun isoWeekdayToEnum(iso: Int): DayOfWeek = DayOfWeek.of(iso)
}
