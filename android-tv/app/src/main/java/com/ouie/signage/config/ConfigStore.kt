// android-tv/app/src/main/java/com/ouie/signage/config/ConfigStore.kt
package com.ouie.signage.config

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.io.File

/**
 * Persists the last good config + its ETag on disk. Both pieces are needed
 * for the If-None-Match round-trip that keeps polling cheap (spec §6.1).
 * Corrupt config JSON is ignored so a partial-write crash doesn't brick the
 * app; the next 200 response will overwrite both files.
 *
 * This lives under `context.filesDir/signage` so it's process-private and
 * survives upgrades. It is NOT in the cache dir — we want these files to
 * survive Android's low-storage cache auto-clear.
 */
class ConfigStore(
    private val dir: File,
    private val json: Json,
) {

    init { dir.mkdirs() }

    private val configFile get() = File(dir, "config.json")
    private val etagFile   get() = File(dir, "config.etag")

    fun save(config: ConfigDto, eTag: String?) {
        configFile.writeText(json.encodeToString(ConfigDto.serializer(), config))
        if (eTag != null) etagFile.writeText(eTag) else etagFile.delete()
    }

    fun loadConfig(): ConfigDto? {
        if (!configFile.exists()) return null
        return try {
            json.decodeFromString(ConfigDto.serializer(), configFile.readText())
        } catch (e: SerializationException) {
            null
        }
    }

    fun loadETag(): String? =
        if (etagFile.exists()) etagFile.readText().trim().ifBlank { null } else null
}
