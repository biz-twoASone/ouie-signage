// android-tv/app/src/test/java/com/ouie/signage/cache/ChecksumTest.kt
package com.ouie.signage.cache

import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ChecksumTest {

    @get:Rule val tmp = TemporaryFolder()

    @Test
    fun `sha256 of known content matches known digest`() {
        // echo -n "hello" | shasum -a 256
        //   → 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
        val f = tmp.newFile("x.bin").apply { writeText("hello") }
        assertEquals(
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
            Checksum.sha256OfFile(f),
        )
    }

    @Test
    fun `sha256 streams large-ish input without oom`() {
        val f = tmp.newFile("big.bin")
        // 4 MB of deterministic content
        f.outputStream().use { out ->
            val chunk = ByteArray(4096) { (it % 256).toByte() }
            repeat(1024) { out.write(chunk) }
        }
        val hash = Checksum.sha256OfFile(f)
        assertEquals(64, hash.length)
        assertEquals(hash, hash.lowercase())  // lowercase hex
    }
}
