// android-tv/app/src/test/java/com/ouie/signage/config/ConfigDtoTest.kt
// Plan 5 Phase 1 Task 7 — TDD for the app_release field on ConfigDto.
package com.ouie.signage.config

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class ConfigDtoTest {

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    @Test
    fun `decodes app_release block when present`() {
        val raw = """
        {
          "version": "sha256:abc",
          "device": {"id":"d1","store_id":"s1","fallback_playlist_id":null,"timezone":"Asia/Jakarta"},
          "rules": [],
          "playlists": [],
          "media": [],
          "app_release": {
            "version_code": 8,
            "version_name": "0.5.0-p5",
            "sha256": "${"a".repeat(64)}",
            "released_at": "2026-04-24T10:00:00Z",
            "url": "https://r2.example/apks/8.apk?sig=xyz"
          }
        }
        """.trimIndent()
        val cfg = json.decodeFromString<ConfigDto>(raw)
        assertNotNull(cfg.app_release)
        assertEquals(8, cfg.app_release?.version_code)
        assertEquals("0.5.0-p5", cfg.app_release?.version_name)
        assertEquals("a".repeat(64), cfg.app_release?.sha256)
        assertEquals("https://r2.example/apks/8.apk?sig=xyz", cfg.app_release?.url)
    }

    @Test
    fun `decodes null app_release as null`() {
        val raw = """
        {
          "version": "sha256:abc",
          "device": {"id":"d1","store_id":"s1","fallback_playlist_id":null,"timezone":"Asia/Jakarta"},
          "rules": [],
          "playlists": [],
          "media": [],
          "app_release": null
        }
        """.trimIndent()
        val cfg = json.decodeFromString<ConfigDto>(raw)
        assertNull(cfg.app_release)
    }

    @Test
    fun `tolerates omitted app_release field`() {
        val raw = """
        {
          "version": "sha256:abc",
          "device": {"id":"d1","store_id":"s1","fallback_playlist_id":null,"timezone":"Asia/Jakarta"},
          "rules": [],
          "playlists": [],
          "media": []
        }
        """.trimIndent()
        val cfg = json.decodeFromString<ConfigDto>(raw)
        assertNull(cfg.app_release)
    }
}
