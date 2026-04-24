// android-tv/app/src/main/java/com/ouie/signage/service/SignageService.kt
package com.ouie.signage.service

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.ouie.signage.coordinator.RunningCoordinator
import org.koin.android.ext.android.inject

/**
 * Foreground service host. Owns RunningCoordinator's lifetime so playback
 * survives Activity destruction, configuration changes, and (mostly) OS kills.
 *
 * START_STICKY: if the OS does kill us under memory pressure, it will attempt
 * a restart with a null intent — onStartCommand handles that by re-invoking
 * coordinator.start() (idempotent).
 *
 * Called from MainActivity on AppState.Running; from BootReceiver on device boot.
 */
class SignageService : Service() {

    private val coordinator: RunningCoordinator by inject()

    override fun onCreate() {
        super.onCreate()
        val notification = ServiceNotification.build(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                ServiceNotification.NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(ServiceNotification.NOTIFICATION_ID, notification)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        coordinator.start()
        // Best-effort bring MainActivity to foreground. When invoked from
        // BootReceiver, we're inside the FGS tempAllowList window (20s,
        // reason=BOOT_COMPLETED) and BAL allows an activity start. Outside
        // that window (normal app open, service restart) BAL throws and we
        // silently fall through — FSI on the notification is the fallback.
        try {
            val launch = Intent(this, com.ouie.signage.MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            startActivity(launch)
        } catch (_: Throwable) {
            // BAL_BLOCK is expected outside the tempAllowList window.
        }
        return START_STICKY
    }

    override fun onDestroy() {
        coordinator.stop()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
