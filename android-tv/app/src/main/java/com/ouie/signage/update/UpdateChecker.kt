// android-tv/app/src/main/java/com/ouie/signage/update/UpdateChecker.kt
// Plan 5 Phase 1 Task 8.
// Reads the app_release pointer from each config refresh, downloads the APK
// to <cache_root>/updates/<versionCode>.apk, verifies sha256, then hands to
// PackageInstaller. On sha256 mismatch the partial file is deleted so the
// next attempt re-downloads cleanly. On already-cached match, skips the HTTP
// fetch entirely.
package com.ouie.signage.update

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest

interface ApkInstaller {
    suspend fun install(versionCode: Int, apk: File)
}

class UpdateChecker(
    private val httpClient: OkHttpClient,
    private val updatesDir: File,
    private val currentVersionCode: Int,
    private val installer: ApkInstaller,
) {

    @Serializable
    data class Release(
        val version_code: Int,
        val version_name: String,
        val sha256: String,
        val url: String,
    )

    enum class Outcome {
        AlreadyCurrent,
        Installing,
        ChecksumMismatch,
        DownloadFailed,
    }

    suspend fun checkAndDownload(release: Release): Outcome = withContext(Dispatchers.IO) {
        if (release.version_code <= currentVersionCode) return@withContext Outcome.AlreadyCurrent

        updatesDir.mkdirs()
        val target = File(updatesDir, "${release.version_code}.apk")

        // Reuse a previously-completed download if its bytes match the expected
        // sha256. Speeds repeated install attempts (e.g. user dismissed the
        // system dialog and we retry on the next config poll).
        if (target.exists() && sha256Hex(target) == release.sha256) {
            installer.install(release.version_code, target)
            return@withContext Outcome.Installing
        }

        try {
            httpClient.newCall(Request.Builder().url(release.url).get().build()).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext Outcome.DownloadFailed
                val body = resp.body ?: return@withContext Outcome.DownloadFailed
                target.outputStream().use { out -> body.byteStream().copyTo(out) }
            }
        } catch (e: CancellationException) {
            target.delete()
            throw e
        } catch (_: Throwable) {
            target.delete()
            return@withContext Outcome.DownloadFailed
        }

        if (sha256Hex(target) != release.sha256) {
            target.delete()
            return@withContext Outcome.ChecksumMismatch
        }

        installer.install(release.version_code, target)
        Outcome.Installing
    }

    private fun sha256Hex(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
