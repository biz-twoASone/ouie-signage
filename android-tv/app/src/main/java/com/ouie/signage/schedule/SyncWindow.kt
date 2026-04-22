// android-tv/app/src/main/java/com/ouie/signage/schedule/SyncWindow.kt
package com.ouie.signage.schedule

import java.time.LocalTime

/**
 * Spec §6.2: the per-store sync window is stored as two `time` values in the
 * store's local timezone. If `end` is strictly after `start`, the window is
 * a single daily interval. If `end` is earlier than `start`, the window
 * crosses midnight. Equal values = empty window (nothing will ever match).
 *
 * Start is inclusive, end is exclusive — matching how SQL `time >= start AND
 * time < end` is generally written.
 */
object SyncWindow {
    fun isWithin(start: LocalTime, end: LocalTime, now: LocalTime): Boolean {
        if (start == end) return false
        return if (end.isAfter(start)) {
            !now.isBefore(start) && now.isBefore(end)
        } else {
            // Wraps midnight: match [start, 24:00) OR [00:00, end)
            !now.isBefore(start) || now.isBefore(end)
        }
    }
}
