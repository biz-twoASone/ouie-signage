// android-tv/app/src/main/java/com/ouie/signage/service/ServiceNotification.kt
package com.ouie.signage.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * Persistent notification for the foreground service. TVs show this in the
 * system's active-app chrome (MIUI, Google TV) — it's intentionally dull:
 * small icon, fixed text, no tap action. Customers never see it; operators
 * do while managing the TV.
 */
object ServiceNotification {

    private const val CHANNEL_ID = "signage_runner"
    const val NOTIFICATION_ID = 1

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = context.getSystemService(NotificationManager::class.java)
            val existing = mgr.getNotificationChannel(CHANNEL_ID)
            if (existing == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "Signage runner",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "Keeps the player running in the background"
                    setShowBadge(false)
                }
                mgr.createNotificationChannel(channel)
            }
        }
    }

    fun build(context: Context): Notification {
        ensureChannel(context)
        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Signage Player")
            .setContentText("Running")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
}
