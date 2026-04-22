// android-tv/app/src/test/java/com/ouie/signage/config/ConfigRepositoryTest.kt
package com.ouie.signage.config

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.ouie.signage.net.ConfigApi
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import retrofit2.Retrofit

class ConfigRepositoryTest {

    @get:Rule val tmp = TemporaryFolder()

    private lateinit var server: MockWebServer
    private lateinit var api: ConfigApi
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
        api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ConfigApi::class.java)
    }

    @After fun tearDown() { server.shutdown() }

    @Test
    fun `200 with ETag persists config and emits new version`() = runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("ETag", "\"sha256:v1\"")
                .setBody(
                    """{"version":"sha256:v1","device":{"id":"d1","store_id":"s1","timezone":"Asia/Jakarta"}}"""
                ),
        )
        val store = ConfigStore(tmp.newFolder(), json)
        val repo = ConfigRepository(api, store)

        val result = repo.fetch()

        assertEquals(ConfigRepository.Result.Applied("sha256:v1"), result)
        val saved = store.loadConfig()
        assertNotNull(saved)
        assertEquals("sha256:v1", saved!!.version)
        assertEquals("\"sha256:v1\"", store.loadETag())
    }

    @Test
    fun `304 returns NotModified without touching store`() = runBlocking {
        val store = ConfigStore(tmp.newFolder(), json)
        // Prime the store with v1
        store.save(
            ConfigDto("sha256:v1", DeviceDto("d1", "s1", null, "Asia/Jakarta")),
            eTag = "\"sha256:v1\"",
        )
        server.enqueue(MockResponse().setResponseCode(304))

        val repo = ConfigRepository(api, store)
        val result = repo.fetch()

        assertEquals(ConfigRepository.Result.NotModified, result)
        // The request we sent must have echoed the previous ETag.
        val sent = server.takeRequest()
        assertEquals("\"sha256:v1\"", sent.getHeader("If-None-Match"))
    }

    @Test
    fun `5xx surfaces as Error without corrupting store`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503))
        val store = ConfigStore(tmp.newFolder(), json)
        val repo = ConfigRepository(api, store)

        val result = repo.fetch()

        assertEquals(true, result is ConfigRepository.Result.Error)
        assertNull(store.loadConfig())
    }
}
