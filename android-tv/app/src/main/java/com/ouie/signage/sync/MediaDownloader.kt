// android-tv/app/src/main/java/com/ouie/signage/sync/MediaDownloader.kt
package com.ouie.signage.sync

import com.ouie.signage.cache.CacheLayout
import com.ouie.signage.cache.Checksum
import com.ouie.signage.config.MediaDto
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File

/**
 * Downloads one media blob to disk with sha256 verification. Operates on the
 * shared OkHttp — any 401 path is handled by TokenAuthenticator (not that R2
 * signed URLs return 401; they return 403 on invalidation, so we treat both
 * 4xx and 5xx as NetworkError).
 *
 * Flow:
 *   1. GET url, stream response body to <cache>/media/<id>.<ext>.part
 *   2. sha256 the temp file
 *   3. On match: atomic-rename to <cache>/media/<id>.<ext>, return Success
 *   4. On mismatch: delete temp, return ChecksumMismatch
 *
 * The coroutine runs network+disk I/O on Dispatchers.IO. Caller (MediaSyncWorker)
 * is expected to serialize calls — spec §6.2 mandates one download at a time so
 * we don't thrash weak WiFi.
 */
class MediaDownloader(
    private val httpClient: OkHttpClient,
    val layout: CacheLayout,
) {

    sealed interface Result {
        data object Success : Result
        data class ChecksumMismatch(val expected: String, val actual: String) : Result
        data class NetworkError(val code: Int?, val cause: Throwable?) : Result
    }

    suspend fun download(media: MediaDto, expectedExt: String): Result = withContext(Dispatchers.IO) {
        layout.mediaDir().mkdirs()
        val temp = layout.tempFile(media.id, expectedExt)
        val dest = layout.mediaFile(media.id, expectedExt)

        // Clean up any stale partial from a previous attempt.
        if (temp.exists()) temp.delete()

        val response = try {
            httpClient.newCall(Request.Builder().url(media.url).build()).execute()
        } catch (e: CancellationException) {
            throw e
        } catch (t: Throwable) {
            return@withContext Result.NetworkError(code = null, cause = t)
        }

        response.use { resp ->
            if (!resp.isSuccessful) return@withContext Result.NetworkError(resp.code, null)
            val body = resp.body ?: return@withContext Result.NetworkError(resp.code, null)
            try {
                body.byteStream().use { input ->
                    temp.outputStream().use { output ->
                        input.copyTo(output, bufferSize = 64 * 1024)
                    }
                }
            } catch (e: CancellationException) {
                temp.delete()
                throw e
            } catch (t: Throwable) {
                temp.delete()
                return@withContext Result.NetworkError(code = null, cause = t)
            }
        }

        val actualHash = Checksum.sha256OfFile(temp)
        if (actualHash != media.checksum) {
            temp.delete()
            return@withContext Result.ChecksumMismatch(expected = media.checksum, actual = actualHash)
        }

        // Atomic rename within the same directory = same-volume move.
        if (dest.exists()) dest.delete()
        if (!temp.renameTo(dest)) {
            // Extremely rare — fall back to copy + delete.
            temp.copyTo(dest, overwrite = true)
            temp.delete()
        }
        Result.Success
    }
}
