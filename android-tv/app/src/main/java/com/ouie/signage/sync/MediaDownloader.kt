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

class MediaDownloader(
    private val httpClient: OkHttpClient,
    val layout: CacheLayout,
    /**
     * Pre-download hook that gets a chance to free enough disk space. Returns
     * `true` if the caller can safely proceed, `false` to skip the download.
     */
    private val ensureSpace: (bytes: Long) -> Boolean = { true },
) {

    sealed interface Result {
        data object Success : Result
        data object InsufficientSpace : Result
        data class ChecksumMismatch(val expected: String, val actual: String) : Result
        data class NetworkError(val code: Int?, val cause: Throwable?) : Result
    }

    suspend fun download(media: MediaDto, expectedExt: String): Result = withContext(Dispatchers.IO) {
        if (!ensureSpace(media.size_bytes)) return@withContext Result.InsufficientSpace

        layout.mediaDir().mkdirs()
        val temp = layout.tempFile(media.id, expectedExt)
        val dest = layout.mediaFile(media.id, expectedExt)

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
                    temp.outputStream().use { output -> input.copyTo(output, bufferSize = 64 * 1024) }
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

        if (dest.exists()) dest.delete()
        if (!temp.renameTo(dest)) {
            temp.copyTo(dest, overwrite = true)
            temp.delete()
        }
        Result.Success
    }
}
