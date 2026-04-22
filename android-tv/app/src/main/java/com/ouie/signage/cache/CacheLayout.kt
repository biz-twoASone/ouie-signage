// android-tv/app/src/main/java/com/ouie/signage/cache/CacheLayout.kt
package com.ouie.signage.cache

import java.io.File

/**
 * Pure file-path math for the on-disk layout described in spec §6.5:
 *   <root>/media/<media_id>.<ext>
 *   <root>/media.db
 * The "media" subdirectory groups cached blobs so later tooling (3c preload,
 * cache-clear) can operate on a single folder. Temp files use a `.part`
 * suffix and live in the same folder so the final rename is a same-volume
 * atomic rename.
 */
class CacheLayout(val root: File) {

    fun mediaDir(): File = File(root, "media")

    fun mediaFile(mediaId: String, ext: String): File =
        File(mediaDir(), "$mediaId.$ext")

    fun tempFile(mediaId: String, ext: String): File =
        File(mediaDir(), "$mediaId.$ext.part")

    fun indexDbFile(): File = File(root, "media.db")

    companion object {
        /**
         * Extract the file extension from an R2 object key OR a signed R2 URL.
         * Strips any query string (`?X-Amz-Signature=…`) or fragment before
         * finding the last dot, since MediaSyncWorker hands us the full signed
         * URL directly. If no extension is present, returns "bin".
         */
        fun extensionFromR2Path(r2Path: String): String {
            val pathPart = r2Path.substringBefore('?').substringBefore('#')
            val slash = pathPart.lastIndexOf('/')
            val dot = pathPart.lastIndexOf('.')
            return if (dot > slash && dot < pathPart.length - 1) pathPart.substring(dot + 1).lowercase()
                   else "bin"
        }
    }
}
