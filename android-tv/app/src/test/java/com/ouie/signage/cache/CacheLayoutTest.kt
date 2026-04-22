// android-tv/app/src/test/java/com/ouie/signage/cache/CacheLayoutTest.kt
package com.ouie.signage.cache

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class CacheLayoutTest {

    @Test
    fun `media file path joins root, media subdir, id, and extension`() {
        val layout = CacheLayout(File("/some/cache"))
        val file = layout.mediaFile("abc-123", "mp4")
        assertEquals(File("/some/cache/media/abc-123.mp4"), file)
    }

    @Test
    fun `extension is derived from r2 path when caller does not have it explicitly`() {
        assertEquals("mp4", CacheLayout.extensionFromR2Path("/tenants/t/media/abc.mp4"))
        assertEquals("jpg", CacheLayout.extensionFromR2Path("/tenants/t/media/abc.jpg"))
        assertEquals("bin", CacheLayout.extensionFromR2Path("/tenants/t/media/no-extension"))
    }

    @Test
    fun `extension strips query string and fragment from signed r2 urls`() {
        assertEquals(
            "mp4",
            CacheLayout.extensionFromR2Path(
                "https://acct.r2.cloudflarestorage.com/tenants/t/media/abc.mp4?X-Amz-Signature=abc&X-Amz-Date=2026",
            ),
        )
        assertEquals("jpg", CacheLayout.extensionFromR2Path("https://host/abc.jpg#frag"))
    }

    @Test
    fun `temp file path is a sibling with part suffix`() {
        val layout = CacheLayout(File("/x"))
        assertEquals(File("/x/media/id.mp4.part"), layout.tempFile("id", "mp4"))
    }

    @Test
    fun `db file is under root`() {
        assertEquals(File("/x/media.db"), CacheLayout(File("/x")).indexDbFile())
    }
}
