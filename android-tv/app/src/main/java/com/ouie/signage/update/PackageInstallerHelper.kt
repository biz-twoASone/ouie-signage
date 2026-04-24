// android-tv/app/src/main/java/com/ouie/signage/update/PackageInstallerHelper.kt
// Plan 5 Phase 1 Task 9.
// Wraps PackageInstaller.Session for sideload-installs initiated by the app.
// The user must have granted "Install unknown apps" for our package via
// Settings — we surface a clear error via ErrorBus when canRequestPackageInstalls()
// returns false. Note: install REPLACES the running app — Android kills our
// process and restarts it after install completes. SignageService START_STICKY
// brings the headless service back; MainActivity reopens via launcher when the
// operator next interacts.
package com.ouie.signage.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import com.ouie.signage.errorbus.ErrorBus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

class PackageInstallerHelper(
    private val context: Context,
    private val errorBus: ErrorBus,
) : ApkInstaller {

    override suspend fun install(versionCode: Int, apk: File) = withContext(Dispatchers.IO) {
        val pm = context.packageManager
        if (!pm.canRequestPackageInstalls()) {
            errorBus.report(
                kind = "ota_install_blocked",
                mediaId = null,
                message = "Install unknown apps not granted — go to Settings → Apps → Special access → Install unknown apps and enable for Signage",
            )
            return@withContext
        }

        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            apk.inputStream().use { input ->
                session.openWrite("apk", 0, apk.length()).use { output ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        output.write(buf, 0, n)
                    }
                    session.fsync(output)
                }
            }

            // Status PendingIntent — required by PackageInstaller.commit().
            // We don't process the result (Android's system dialog handles UX);
            // the broadcast is fired only so commit() doesn't reject for a
            // missing receiver. Using FLAG_MUTABLE because the system fills in
            // status extras.
            val statusIntent = Intent("com.ouie.signage.OTA_INSTALL_STATUS")
                .setPackage(context.packageName)
            val statusPi = PendingIntent.getBroadcast(
                context,
                versionCode,
                statusIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            session.commit(statusPi.intentSender)
        }
    }
}
