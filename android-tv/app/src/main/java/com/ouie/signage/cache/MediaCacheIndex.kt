// android-tv/app/src/main/java/com/ouie/signage/cache/MediaCacheIndex.kt
package com.ouie.signage.cache

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.io.File

/**
 * Tracks every media blob we've cached. One row per media_id. The `path` column
 * stores the absolute file path so a cache-root change (e.g. USB re-mounted on a
 * different letter) would invalidate everything — which is what we want.
 *
 * We do NOT use Room because:
 *   1. Single table, no migrations expected during v1.
 *   2. Avoids pulling kapt/ksp into the build.
 *
 * The `helper` is tied to the cache root's index file; callers create a fresh
 * `MediaCacheIndex` when the resolver picks a different root (e.g., USB plugged
 * or unplugged). `CacheManager` does this.
 */
class MediaCacheIndex(context: Context, dbFile: File) {

    private val helper = object : SQLiteOpenHelper(
        context.applicationContext,
        dbFile.absolutePath,  // absolute path → DB lives at <cache_root>/media.db
        /* factory = */ null,
        DB_VERSION,
    ) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL("""
                CREATE TABLE $TABLE (
                    media_id TEXT PRIMARY KEY,
                    ext TEXT NOT NULL,
                    checksum TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    cached_at INTEGER NOT NULL,
                    last_played_at INTEGER
                )
            """.trimIndent())
        }
        override fun onUpgrade(db: SQLiteDatabase, oldV: Int, newV: Int) {
            // No migrations yet. If we ever bump DB_VERSION, drop+recreate is fine —
            // the files are still on disk; next config sync will re-insert rows.
            db.execSQL("DROP TABLE IF EXISTS $TABLE")
            onCreate(db)
        }
    }

    data class Entry(
        val mediaId: String,
        val ext: String,
        val checksum: String,
        val sizeBytes: Long,
        val cachedAtEpochSeconds: Long,
        val lastPlayedAtEpochSeconds: Long?,
    )

    fun upsert(entry: Entry) {
        helper.writableDatabase.insertWithOnConflict(
            TABLE,
            null,
            ContentValues().apply {
                put("media_id", entry.mediaId)
                put("ext", entry.ext)
                put("checksum", entry.checksum)
                put("size_bytes", entry.sizeBytes)
                put("cached_at", entry.cachedAtEpochSeconds)
                entry.lastPlayedAtEpochSeconds?.let { put("last_played_at", it) }
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    fun find(mediaId: String): Entry? {
        helper.readableDatabase.rawQuery(
            "SELECT ext, checksum, size_bytes, cached_at, last_played_at FROM $TABLE WHERE media_id = ?",
            arrayOf(mediaId),
        ).use { c ->
            if (!c.moveToFirst()) return null
            return Entry(
                mediaId = mediaId,
                ext = c.getString(0),
                checksum = c.getString(1),
                sizeBytes = c.getLong(2),
                cachedAtEpochSeconds = c.getLong(3),
                lastPlayedAtEpochSeconds = if (c.isNull(4)) null else c.getLong(4),
            )
        }
    }

    fun markPlayed(mediaId: String, epochSeconds: Long) {
        helper.writableDatabase.execSQL(
            "UPDATE $TABLE SET last_played_at = ? WHERE media_id = ?",
            arrayOf<Any>(epochSeconds, mediaId),
        )
    }

    fun delete(mediaId: String) {
        helper.writableDatabase.delete(TABLE, "media_id = ?", arrayOf(mediaId))
    }

    private companion object {
        const val DB_VERSION = 1
        const val TABLE = "media_cache"
    }
}
