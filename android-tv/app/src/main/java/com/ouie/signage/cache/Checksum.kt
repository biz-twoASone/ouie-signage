// android-tv/app/src/main/java/com/ouie/signage/cache/Checksum.kt
package com.ouie.signage.cache

import java.io.File
import java.security.MessageDigest

object Checksum {

    private const val BUFFER_BYTES = 64 * 1024

    /**
     * Streams the file through SHA-256 and returns the lowercase hex digest.
     * Spec §4 stores checksums as lowercase hex (same format minted by the
     * dashboard's R2 upload pre-sign step), so we match that exactly.
     */
    fun sha256OfFile(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(BUFFER_BYTES)
            while (true) {
                val n = input.read(buf)
                if (n <= 0) break
                digest.update(buf, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
