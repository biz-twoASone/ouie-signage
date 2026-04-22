// android-tv/app/src/main/java/com/ouie/signage/preload/PreloadIndex.kt
package com.ouie.signage.preload

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.io.File

/**
 * Caches (path, size, mtime, sha256) tuples so re-scans skip unchanged files.
 * Hashing a 2 GB MP4 takes 10–30 s on mid-tier TV SoCs (spec §6.6); one-shot
 * per file via this index.
 *
 * Lives at `<cache_root>/../preload_index.db` — deliberately a sibling of
 * media.db rather than inside the cache folder, since USB may vanish.
 */
class PreloadIndex(context: Context, dbFile: File) {

    private val helper = object : SQLiteOpenHelper(
        context.applicationContext,
        dbFile.absolutePath,
        null,
        DB_VERSION,
    ) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL("""
                CREATE TABLE $TABLE (
                    path TEXT PRIMARY KEY,
                    size_bytes INTEGER NOT NULL,
                    mtime_ms INTEGER NOT NULL,
                    sha256 TEXT NOT NULL,
                    seen_at INTEGER NOT NULL
                )
            """.trimIndent())
        }
        override fun onUpgrade(db: SQLiteDatabase, oldV: Int, newV: Int) {
            db.execSQL("DROP TABLE IF EXISTS $TABLE")
            onCreate(db)
        }
    }

    data class Entry(
        val path: String,
        val sizeBytes: Long,
        val mtimeMs: Long,
        val sha256: String,
        val seenAtEpochSeconds: Long,
    )

    fun find(path: String): Entry? {
        helper.readableDatabase.rawQuery(
            "SELECT size_bytes, mtime_ms, sha256, seen_at FROM $TABLE WHERE path = ?",
            arrayOf(path),
        ).use { c ->
            if (!c.moveToFirst()) return null
            return Entry(
                path = path,
                sizeBytes = c.getLong(0),
                mtimeMs = c.getLong(1),
                sha256 = c.getString(2),
                seenAtEpochSeconds = c.getLong(3),
            )
        }
    }

    fun upsert(e: Entry) {
        helper.writableDatabase.insertWithOnConflict(
            TABLE, null,
            ContentValues().apply {
                put("path", e.path)
                put("size_bytes", e.sizeBytes)
                put("mtime_ms", e.mtimeMs)
                put("sha256", e.sha256)
                put("seen_at", e.seenAtEpochSeconds)
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    fun delete(path: String) {
        helper.writableDatabase.delete(TABLE, "path = ?", arrayOf(path))
    }

    private companion object {
        const val DB_VERSION = 1
        const val TABLE = "preload_index"
    }
}
