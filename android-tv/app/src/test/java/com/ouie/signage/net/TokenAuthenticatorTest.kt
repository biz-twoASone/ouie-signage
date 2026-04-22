package com.ouie.signage.net

import com.ouie.signage.auth.DeviceTokens
import com.ouie.signage.auth.TokenStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import java.util.concurrent.atomic.AtomicReference

class TokenAuthenticatorTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `401 triggers refresh and retries original request`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(200).setBody("ok"))

        val tokenStore = FakeTokenStore(
            initial = DeviceTokens(
                accessToken = "old",
                refreshToken = "rt1",
                deviceId = "dev-1",
                expiresInSeconds = 3600,
            ),
        )
        val refreshAdapter = FakeRefreshAdapter { DeviceTokens(
            accessToken = "new",
            refreshToken = "rt2",
            deviceId = "dev-1",
            expiresInSeconds = 3600,
        ) }
        val authenticator = TokenAuthenticator(
            tokenStore = tokenStore,
            refreshAdapter = refreshAdapter,
        )

        val client = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(tokenStore))
            .authenticator(authenticator)
            .build()

        val response = client.newCall(
            Request.Builder().url(server.url("/devices-heartbeat")).build()
        ).execute()

        assertEquals(200, response.code)
        server.takeRequest()
        val retry = server.takeRequest()
        assertEquals("Bearer new", retry.getHeader("Authorization"))
    }

    @Test
    fun `concurrent 401s share a single refresh`() {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(200).setBody("one"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("two"))

        val tokenStore = FakeTokenStore(
            initial = DeviceTokens("old", "rt1", "dev-1", 3600),
        )
        val refreshCount = AtomicReference(0)
        val refreshAdapter = FakeRefreshAdapter {
            refreshCount.getAndUpdate { it + 1 }
            Thread.sleep(100)
            DeviceTokens("new", "rt2", "dev-1", 3600)
        }
        val authenticator = TokenAuthenticator(tokenStore, refreshAdapter)
        val client = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(tokenStore))
            .authenticator(authenticator)
            .build()

        val r1 = Thread { client.newCall(Request.Builder().url(server.url("/a")).build()).execute() }
        val r2 = Thread { client.newCall(Request.Builder().url(server.url("/b")).build()).execute() }
        r1.start(); r2.start(); r1.join(); r2.join()

        assertEquals(1, refreshCount.get())
    }

    @Test
    fun `refresh 401 clears the token store`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401))

        val tokenStore = FakeTokenStore(
            initial = DeviceTokens("old", "rt1", "dev-1", 3600),
        )
        val refreshAdapter = FakeRefreshAdapter { throw RuntimeException("refresh failed") }
        val authenticator = TokenAuthenticator(tokenStore, refreshAdapter)
        val client = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(tokenStore))
            .authenticator(authenticator)
            .build()

        val response = client.newCall(
            Request.Builder().url(server.url("/x")).build()
        ).execute()

        assertEquals(401, response.code)
        assertEquals(null, tokenStore.loadSync())
    }
}

/** Minimal TokenStore stand-in — production uses EncryptedSharedPreferences. */
private class FakeTokenStore(initial: DeviceTokens?) : com.ouie.signage.auth.TokenSource {
    private var tokens: DeviceTokens? = initial
    override fun loadSync(): DeviceTokens? = tokens
    override fun save(tokens: DeviceTokens) { this.tokens = tokens }
    override fun clear() { tokens = null }
}

private class FakeRefreshAdapter(
    private val produce: suspend () -> DeviceTokens,
) : RefreshAdapter {
    override suspend fun refresh(current: DeviceTokens): DeviceTokens = produce()
}
