package com.ouie.signage.pairing

import com.ouie.signage.net.PairingApi
import com.ouie.signage.net.PairingRequestBody
import com.ouie.signage.net.PairingRequestResponse
import com.ouie.signage.net.PairingStatusResponse
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Response

@OptIn(ExperimentalCoroutinesApi::class)
class PairingRepositoryTest {

    @Test
    fun `requestCode returns code + expiresAt`() = runTest {
        val api = object : PairingApi {
            override suspend fun requestCode(body: PairingRequestBody) =
                PairingRequestResponse(code = "ABC234", expires_at = "2026-04-22T12:00:00Z")
            override suspend fun status(code: String) = error("unused")
        }
        val repo = PairingRepository(api, proposedName = "TV-1")
        val (code, _) = repo.requestCode()
        assertEquals("ABC234", code)
    }

    @Test
    fun `observeClaim returns pending then paired`() = runTest {
        var calls = 0
        val api = object : PairingApi {
            override suspend fun requestCode(body: PairingRequestBody) = error("unused")
            override suspend fun status(code: String): Response<PairingStatusResponse> {
                calls++
                return if (calls < 3) {
                    Response.success(PairingStatusResponse(status = "pending"))
                } else {
                    Response.success(PairingStatusResponse(
                        status = "paired",
                        device_id = "dev-1",
                        access_token = "at",
                        refresh_token = "rt",
                        expires_in = 3600,
                    ))
                }
            }
        }
        val repo = PairingRepository(api, proposedName = "TV-1", pollIntervalMs = 10)
        val result = repo.observeClaim("ABC234")
        assertTrue(result is PairingRepository.ClaimResult.Paired)
        val paired = result as PairingRepository.ClaimResult.Paired
        assertEquals("dev-1", paired.tokens.deviceId)
        assertEquals("at", paired.tokens.accessToken)
        assertNotNull(paired.tokens.refreshToken)
    }

    @Test
    fun `observeClaim returns Expired when status flips to expired`() = runTest {
        val api = object : PairingApi {
            override suspend fun requestCode(body: PairingRequestBody) = error("unused")
            override suspend fun status(code: String) =
                Response.success(PairingStatusResponse(status = "expired"))
        }
        val repo = PairingRepository(api, proposedName = "TV-1", pollIntervalMs = 1)
        assertTrue(repo.observeClaim("ABC234") is PairingRepository.ClaimResult.Expired)
    }

    @Test
    fun `observeClaim returns PickupConsumed when tokens already drained`() = runTest {
        val api = object : PairingApi {
            override suspend fun requestCode(body: PairingRequestBody) = error("unused")
            override suspend fun status(code: String) =
                Response.success(PairingStatusResponse(
                    status = "paired_pickup_consumed",
                    device_id = "dev-1",
                ))
        }
        val repo = PairingRepository(api, proposedName = "TV-1", pollIntervalMs = 1)
        assertTrue(repo.observeClaim("ABC234") is PairingRepository.ClaimResult.PickupConsumed)
    }

    @Test
    fun `observeClaim returns PickupConsumed when paired status has null tokens`() = runTest {
        val api = object : PairingApi {
            override suspend fun requestCode(body: PairingRequestBody) = error("unused")
            override suspend fun status(code: String) =
                Response.success(PairingStatusResponse(
                    status = "paired",
                    device_id = "dev-1",
                    access_token = null,
                    refresh_token = null,
                ))
        }
        val repo = PairingRepository(api, proposedName = "TV-1", pollIntervalMs = 1)
        assertTrue(repo.observeClaim("ABC234") is PairingRepository.ClaimResult.PickupConsumed)
    }

    @Test
    fun `observeClaim rethrows CancellationException during status call`() = runTest {
        val api = object : PairingApi {
            override suspend fun requestCode(body: PairingRequestBody) = error("unused")
            override suspend fun status(code: String): Response<PairingStatusResponse> {
                awaitCancellation()
            }
        }
        val repo = PairingRepository(api, proposedName = "TV-1", pollIntervalMs = 1)
        val job = launch { repo.observeClaim("ABC234") }
        advanceUntilIdle()
        job.cancelAndJoin()
        assertTrue(job.isCancelled)
    }
}
