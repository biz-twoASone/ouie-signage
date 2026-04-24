// android-tv/app/src/main/java/com/ouie/signage/service/ServiceNotification.kt
package com.ouie.signage.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.ouie.signage.MainActivity

/**
 * Persistent notification for the foreground service. Serves two purposes:
 * 1. Required for any foreground service (Android 8+).
 * 2. Carries a full-screen intent pointing to MainActivity so that the
 *    foreground activity is auto-brought-up when the service starts
 *    post-boot. Android 14 blocks BootReceiver from calling startActivity
 *    (BAL_BLOCK), but a high-importance notification with
 *    setFullScreenIntent bypasses that path because it's the standard
 *    mechanism for incoming-call / alarm / kiosk apps.
 *
 * Channel is v2 with IMPORTANCE_HIGH — FSI requires high-importance or
 * greater. Existing v1 channel (signage_runner, LOW) is left alone since
 * NotificationManager can't upgrade a channel's importance after creation.
 * Users upgrading from pre-4.3 can clear app data to drop the old channel.
 */
object ServiceNotification {

    private const val CHANNEL_ID = "signage_runner_v2"
    const val NOTIFICATION_ID = 1

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = context.getSystemService(NotificationManager::class.java)
            val existing = mgr.getNotificationChannel(CHANNEL_ID)
            if (existing == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "Signage runner",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Keeps the player running and returns it to the foreground"
                    setShowBadge(false)
                    setSound(null, null)
                    enableVibration(false)
                }
                mgr.createNotificationChannel(channel)
            }
        }
    }

    private fun mainActivityPendingIntent(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getActivity(context, 0, intent, flags)
    }

    fun build(context: Context): Notification {
        ensureChannel(context)
        val pi = mainActivityPendingIntent(context)
        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Signage Player")
            .setContentText("Running")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(pi)
            .setFullScreenIntent(pi, true)
            .build()
    }
}
