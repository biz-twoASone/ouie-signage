// android-tv/app/src/test/java/com/ouie/signage/cache/CacheRootResolverTest.kt
package com.ouie.signage.cache

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class CacheRootResolverTest {

    private val internalDir = File("/internal")
    private val usb = File("/usb")
    private val sd = File("/sd")

    @Test
    fun `picks external with highest free bytes when above threshold`() {
        val pick = CacheRootResolver.pick(
            candidates = listOf(
                CacheRootResolver.Candidate(usb, freeBytes = 20L * 1024 * 1024 * 1024, isExternal = true),
                CacheRootResolver.Candidate(sd,  freeBytes = 10L * 1024 * 1024 * 1024, isExternal = true),
            ),
            internalDir = internalDir,
            internalFreeBytes = 8L * 1024 * 1024 * 1024,
            minExternalBytes = 4L * 1024 * 1024 * 1024,
        )
        assertEquals(usb, pick.root)
        assertEquals(CacheRootResolver.Kind.External, pick.kind)
        assertEquals(false, pick.degraded)
    }

    @Test
    fun `falls back to internal when all externals below threshold`() {
        val pick = CacheRootResolver.pick(
            candidates = listOf(
                CacheRootResolver.Candidate(usb, freeBytes = 1L * 1024 * 1024 * 1024, isExternal = true),
            ),
            internalDir = internalDir,
            internalFreeBytes = 8L * 1024 * 1024 * 1024,
            minExternalBytes = 4L * 1024 * 1024 * 1024,
        )
        assertEquals(internalDir, pick.root)
        assertEquals(CacheRootResolver.Kind.Internal, pick.kind)
        assertEquals(true, pick.degraded)
    }

    @Test
    fun `falls back to internal when no externals returned`() {
        val pick = CacheRootResolver.pick(
            candidates = emptyList(),
            internalDir = internalDir,
            internalFreeBytes = 8L * 1024 * 1024 * 1024,
            minExternalBytes = 4L * 1024 * 1024 * 1024,
        )
        assertEquals(internalDir, pick.root)
        assertEquals(CacheRootResolver.Kind.Internal, pick.kind)
        assertEquals(true, pick.degraded)
    }

    @Test
    fun `prefers internal only when external dominates by free space`() {
        // Even if internal has a lot free, an external above threshold wins — spec §6.5.
        val pick = CacheRootResolver.pick(
            candidates = listOf(
                CacheRootResolver.Candidate(usb, freeBytes = 5L * 1024 * 1024 * 1024, isExternal = true),
            ),
            internalDir = internalDir,
            internalFreeBytes = 50L * 1024 * 1024 * 1024,
            minExternalBytes = 4L * 1024 * 1024 * 1024,
        )
        assertEquals(usb, pick.root)
        assertEquals(CacheRootResolver.Kind.External, pick.kind)
    }
}
