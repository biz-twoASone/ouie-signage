package com.ouie.signage.fcm

import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Lazily obtains the FCM token and caches it in-memory. `current()` returns the
 * most recent value or null if we haven't fetched yet. The first heartbeat
 * after boot may carry null (unless cached) — subsequent heartbeats will have
 * the token.
 *
 * Also handles token-refresh callbacks from FCM: MessagingService.onNewToken
 * calls `update(newToken)` so the next heartbeat ships the fresh value.
 */
class FcmTokenSource(private val scope: CoroutineScope) {

    @Volatile private var cached: String? = null

    fun current(): String? = cached

    fun update(token: String) { cached = token }

    /**
     * Fire-and-forget bootstrap from the coordinator. Resolves a token, stores
     * it. Failure is silently ignored — FCM will retry on its own.
     */
    fun prime() {
        scope.launch(Dispatchers.IO) {
            try {
                val token = awaitToken()
                cached = token
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                // Google Play Services missing / network / etc. Heartbeat carries null.
            }
        }
    }

    private suspend fun awaitToken(): String = suspendCancellableCoroutine { cont ->
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { cont.resume(it) }
            .addOnFailureListener { cont.resumeWithException(it) }
    }
}
