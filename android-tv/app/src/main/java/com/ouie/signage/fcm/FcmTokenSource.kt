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
open class FcmTokenSource(private val scope: CoroutineScope) {

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

    /**
     * Plan 5 Task 20: hard re-acquire the FCM token by deleting then re-fetching.
     * Side effect: GMS exercises the MTALK socket, which (per Plan 4.1 follow-up
     * hypothesis) may unstick a post-reboot scenario where the receive socket
     * fails to re-establish. Speculative — we cannot prove root cause without
     * ADB on the TCL TV, but the cost is one extra RPC per boot.
     *
     * Suspending: caller should await before issuing the first heartbeat, but
     * failures are silent (heartbeat carries the cached value, which may still
     * be the stale one — same behavior as before).
     *
     * Open so unit tests in Task 21 can subclass with a counting/throwing double.
     */
    open suspend fun forceRefresh() {
        try {
            suspendCancellableCoroutine<Unit> { cont ->
                FirebaseMessaging.getInstance().deleteToken()
                    .addOnSuccessListener { cont.resume(Unit) }
                    .addOnFailureListener { cont.resumeWithException(it) }
            }
            val fresh = awaitToken()
            cached = fresh
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            // Same swallow as prime() — heartbeat will carry cached or null.
        }
    }

    private suspend fun awaitToken(): String = suspendCancellableCoroutine { cont ->
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { cont.resume(it) }
            .addOnFailureListener { cont.resumeWithException(it) }
    }
}
