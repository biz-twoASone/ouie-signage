// android-tv/app/src/test/java/com/ouie/signage/sync/MediaDownloaderTest.kt
package com.ouie.signage.sync

import com.ouie.signage.cache.CacheLayout
import com.ouie.signage.cache.Checksum
import com.ouie.signage.config.MediaDto
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class MediaDownloaderTest {

    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer

    @Before fun setUp()    { server = MockWebServer().apply { start() } }
    @After  fun tearDown() { server.shutdown() }

    private fun layout(): CacheLayout {
        val root = tmp.newFolder()
        File(root, "media").mkdirs()
        return CacheLayout(root)
    }

    @Test
    fun `happy path — writes file and returns Success with checksum`() = runBlocking {
        val body = "hello world"
        // shasum -a 256 of "hello world":
        val expected = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        server.enqueue(MockResponse().setBody(Buffer().writeUtf8(body)))

        val dl = MediaDownloader(OkHttpClient(), layout())
        val result = dl.download(
            MediaDto(
                id = "m1", kind = "video", size_bytes = body.length.toLong(),
                checksum = expected,
                url = server.url("/file.mp4").toString(),
            ),
            expectedExt = "mp4",
        )
        assertEquals(MediaDownloader.Result.Success, result)
        val file = dl.layout.mediaFile("m1", "mp4")
        assertTrue(file.exists())
        assertEquals(expected, Checksum.sha256OfFile(file))
    }

    @Test
    fun `checksum mismatch deletes partial and returns ChecksumMismatch`() = runBlocking {
        server.enqueue(MockResponse().setBody("hello world"))
        val dl = MediaDownloader(OkHttpClient(), layout())
        val result = dl.download(
            MediaDto(
                id = "m1", kind = "video", size_bytes = 11,
                checksum = "0".repeat(64),          // intentionally wrong
                url = server.url("/bad.mp4").toString(),
            ),
            expectedExt = "mp4",
        )
        assertEquals(true, result is MediaDownloader.Result.ChecksumMismatch)
        assertFalse(dl.layout.mediaFile("m1", "mp4").exists())
        assertFalse(dl.layout.tempFile("m1", "mp4").exists())
    }

    @Test
    fun `5xx returns NetworkError`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503))
        val dl = MediaDownloader(OkHttpClient(), layout())
        val result = dl.download(
            MediaDto(
                id = "m1", kind = "video", size_bytes = 1,
                checksum = "0".repeat(64),
                url = server.url("/fail").toString(),
            ),
            expectedExt = "mp4",
        )
        assertEquals(true, result is MediaDownloader.Result.NetworkError)
    }

    @Test
    fun `ensureSpace returning false short-circuits to InsufficientSpace`() = runBlocking {
        val dl = MediaDownloader(OkHttpClient(), layout(), ensureSpace = { false })
        val result = dl.download(
            MediaDto(
                id = "m1", kind = "video", size_bytes = 11,
                checksum = "0".repeat(64),
                url = "http://unused.example/ignored.mp4",
            ),
            expectedExt = "mp4",
        )
        assertEquals(MediaDownloader.Result.InsufficientSpace, result)
        // No HTTP request was made (server queue is untouched).
        assertEquals(0, server.requestCount)
    }
}
