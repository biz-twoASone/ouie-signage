// android-tv/app/src/test/java/com/ouie/signage/config/ConfigStoreTest.kt
package com.ouie.signage.config

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ConfigStoreTest {

    @get:Rule val tmp = TemporaryFolder()

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Test
    fun `save and load roundtrip`() {
        val store = ConfigStore(tmp.newFolder(), json)
        val cfg = ConfigDto(
            version = "sha256:abc",
            device = DeviceDto("dev-1", "store-1", null, "Asia/Jakarta"),
        )
        store.save(cfg, eTag = "\"sha256:abc\"")

        val loaded = store.loadConfig()
        val tag = store.loadETag()
        assertEquals(cfg, loaded)
        assertEquals("\"sha256:abc\"", tag)
    }

    @Test
    fun `loadConfig returns null before first save`() {
        val store = ConfigStore(tmp.newFolder(), json)
        assertNull(store.loadConfig())
        assertNull(store.loadETag())
    }

    @Test
    fun `corrupt stored config is dropped silently`() {
        val dir = tmp.newFolder()
        java.io.File(dir, "config.json").writeText("this is not json {")
        java.io.File(dir, "config.etag").writeText("\"sha256:xyz\"")
        val store = ConfigStore(dir, json)
        assertNull(store.loadConfig())
        // ETag is still present; we'll happily re-send it with the next GET
        // and the server will reply 200 with fresh config.
        assertEquals("\"sha256:xyz\"", store.loadETag())
    }
}
