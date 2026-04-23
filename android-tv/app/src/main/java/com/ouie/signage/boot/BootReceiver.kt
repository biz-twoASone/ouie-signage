// android-tv/app/src/main/java/com/ouie/signage/boot/BootReceiver.kt
package com.ouie.signage.boot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.ouie.signage.MainActivity
import com.ouie.signage.service.SignageService

/**
 * Auto-start on device boot (Risk #2 mitigation — spec §6.7). Two actions:
 *   1. BOOT_COMPLETED (stock Android)
 *   2. QUICKBOOT_POWERON (MIUI-specific fast-boot intent)
 *
 * Flow:
 *   a. Start SignageService via ContextCompat.startForegroundService. Service
 *      brings the coordinator up so playback resumes even if the Activity
 *      doesn't launch.
 *   b. Attempt to launch MainActivity with FLAG_ACTIVITY_NEW_TASK. On Android
 *      TV this is generally permitted; on phones at API 29+ it may fail
 *      silently — which is why (a) exists first.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON" -> {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, SignageService::class.java),
                )
                // Best-effort activity launch. If OS refuses (background-activity-start
                // restrictions), the service is still running and the operator
                // can tap LEANBACK_LAUNCHER → Signage Player.
                val activity = Intent(context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try { context.startActivity(activity) } catch (_: Throwable) { }
            }
        }
    }
}
