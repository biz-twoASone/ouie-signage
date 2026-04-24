// android-tv/app/src/test/java/com/ouie/signage/update/UpdateCheckerTest.kt
// Plan 5 Phase 1 Task 8 — TDD.
package com.ouie.signage.update

import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class UpdateCheckerTest {

    private lateinit var server: MockWebServer
    private lateinit var workDir: File

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        workDir = createTempDir(prefix = "ota-test")
    }

    @After fun tearDown() {
        server.shutdown()
        workDir.deleteRecursively()
    }

    private fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it) }

    @Test fun `noop when current version is already at or above release`() = runTest {
        val checker = UpdateChecker(
            httpClient = OkHttpClient(),
            updatesDir = workDir,
            currentVersionCode = 10,
            installer = RecordingInstaller(),
        )
        val outcome = checker.checkAndDownload(
            UpdateChecker.Release(
                version_code = 10, version_name = "0.5.0",
                sha256 = "deadbeef".repeat(8), url = "http://unused/",
            ),
        )
        assertEquals(UpdateChecker.Outcome.AlreadyCurrent, outcome)
    }

    @Test fun `downloads, verifies sha256, hands to installer`() = runTest {
        val apkBytes = ByteArray(1024) { (it % 256).toByte() }
        val sha = sha256Hex(apkBytes)
        server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(apkBytes)))
        val installer = RecordingInstaller()
        val checker = UpdateChecker(
            httpClient = OkHttpClient(),
            updatesDir = workDir,
            currentVersionCode = 7,
            installer = installer,
        )
        val outcome = checker.checkAndDownload(
            UpdateChecker.Release(
                version_code = 8, version_name = "0.5.0-p5",
                sha256 = sha, url = server.url("/apk").toString(),
            ),
        )
        assertEquals(UpdateChecker.Outcome.Installing, outcome)
        assertTrue(installer.invocations.size == 1)
        assertEquals(8, installer.invocations[0].versionCode)
        assertTrue(installer.invocations[0].apk.exists())
        assertEquals(apkBytes.size.toLong(), installer.invocations[0].apk.length())
    }

    @Test fun `rejects sha256 mismatch and deletes partial file`() = runTest {
        val apkBytes = ByteArray(1024) { (it % 256).toByte() }
        val wrongSha = "0".repeat(64)
        server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(apkBytes)))
        val installer = RecordingInstaller()
        val checker = UpdateChecker(
            httpClient = OkHttpClient(),
            updatesDir = workDir,
            currentVersionCode = 7,
            installer = installer,
        )
        val outcome = checker.checkAndDownload(
            UpdateChecker.Release(
                version_code = 8, version_name = "0.5.0-p5",
                sha256 = wrongSha, url = server.url("/apk").toString(),
            ),
        )
        assertEquals(UpdateChecker.Outcome.ChecksumMismatch, outcome)
        assertFalse(installer.invocations.any { it.versionCode == 8 })
        // Partial download is removed so next attempt has no stale bytes.
        assertEquals(0, workDir.listFiles()?.size ?: 0)
    }

    @Test fun `skips redownload when local file already matches sha256`() = runTest {
        val apkBytes = ByteArray(1024) { (it % 256).toByte() }
        val sha = sha256Hex(apkBytes)
        // Pre-place a file at the expected path.
        File(workDir, "8.apk").writeBytes(apkBytes)
        val installer = RecordingInstaller()
        val checker = UpdateChecker(
            httpClient = OkHttpClient(),
            updatesDir = workDir,
            currentVersionCode = 7,
            installer = installer,
        )
        val outcome = checker.checkAndDownload(
            UpdateChecker.Release(
                version_code = 8, version_name = "0.5.0-p5",
                sha256 = sha, url = server.url("/never-called").toString(),
            ),
        )
        assertEquals(UpdateChecker.Outcome.Installing, outcome)
        assertEquals(0, server.requestCount) // no HTTP call made
    }
}

private class RecordingInstaller : ApkInstaller {
    data class Invocation(val versionCode: Int, val apk: File)
    val invocations = mutableListOf<Invocation>()
    override suspend fun install(versionCode: Int, apk: File) {
        invocations += Invocation(versionCode, apk)
    }
}
