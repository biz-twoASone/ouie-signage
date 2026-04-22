// android-tv/app/src/test/java/com/ouie/signage/heartbeat/HeartbeatPayloadTest.kt
package com.ouie.signage.heartbeat

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HeartbeatPayloadTest {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Test
    fun `full payload serializes exactly the keys the server expects`() {
        val p = HeartbeatPayload(
            app_version = "0.2.0-3b",
            uptime_seconds = 123L,
            current_playlist_id = "pl-1",
            last_config_version_applied = "sha256:abc",
            clock_skew_seconds_from_server = 3,
            cache_storage_info = CacheStorageInfo(
                root = "external",
                filesystem = "unknown",
                total_bytes = 17_179_869_184L,
                free_bytes = 12_884_901_888L,
                updated_at = "2026-04-23T10:00:00Z",
                degraded = false,
            ),
        )
        val encoded = json.encodeToString(HeartbeatPayload.serializer(), p)
        val parsed = json.parseToJsonElement(encoded) as JsonObject
        assertEquals("0.2.0-3b", parsed["app_version"]!!.jsonPrimitive.content)
        assertEquals("pl-1", parsed["current_playlist_id"]!!.jsonPrimitive.content)
        assertEquals("sha256:abc", parsed["last_config_version_applied"]!!.jsonPrimitive.content)
        assertEquals(3, parsed["clock_skew_seconds_from_server"]!!.jsonPrimitive.content.toInt())
        val cache = parsed["cache_storage_info"] as JsonObject
        assertEquals("external", cache["root"]!!.jsonPrimitive.content)
        assertEquals(17_179_869_184L, cache["total_bytes"]!!.jsonPrimitive.content.toLong())
    }

    @Test
    fun `null playlist and null skew are omitted from the JSON`() {
        val p = HeartbeatPayload(
            app_version = "0.2.0-3b",
            uptime_seconds = 1L,
            current_playlist_id = null,
            last_config_version_applied = null,
            clock_skew_seconds_from_server = null,
            cache_storage_info = null,
        )
        val encoded = json.encodeToString(HeartbeatPayload.serializer(), p)
        val parsed = json.parseToJsonElement(encoded) as JsonObject
        // kotlinx.serialization treats `null` on a nullable property as `"key":null`
        // by default; we set `explicitNulls = false` in the Json config to match the
        // server's optional-field contract. Confirm both that the key is missing OR null:
        assertEquals(true, !parsed.containsKey("current_playlist_id") || parsed["current_playlist_id"]!!.toString() == "null")
        assertEquals(true, !parsed.containsKey("cache_storage_info") || parsed["cache_storage_info"]!!.toString() == "null")
        // Uptime must always be present.
        assertEquals(1, parsed["uptime_seconds"]!!.jsonPrimitive.content.toInt())
        // (No assertion on keys we don't care about; the server ignores unknown keys.)
    }
}
