// android-tv/app/src/main/java/com/ouie/signage/net/TokenAuthenticator.kt
package com.ouie.signage.net

import com.ouie.signage.auth.TokenSource
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route

/**
 * Invoked by OkHttp when a 401 happens. Runs the refresh flow under a mutex so
 * concurrent 401s share one refresh round-trip. If refresh itself fails
 * (any exception), clears the TokenSource and returns null — which makes
 * OkHttp surface the 401 to the caller (who routes it to Pairing state).
 *
 * Suspend bridge: OkHttp's Authenticator.authenticate() is blocking; we bridge
 * to the suspend refresh via runBlocking. The mutex prevents the classic
 * "two concurrent 401s = two refreshes" race (which would have invalidated
 * each other's refresh tokens via server-side CAS rotation).
 */
class TokenAuthenticator(
    private val tokenStore: TokenSource,
    private val refreshAdapter: RefreshAdapter,
) : Authenticator {

    private val mutex = Mutex()

    override fun authenticate(route: Route?, response: Response): Request? {
        val current = tokenStore.loadSync() ?: return null
        val requestAccess = response.request.header("Authorization")
            ?.removePrefix("Bearer ")?.trim()

        return runBlocking {
            mutex.withLock {
                val maybeRotated = tokenStore.loadSync()
                if (maybeRotated != null && maybeRotated.accessToken != requestAccess) {
                    return@withLock response.request.newBuilder()
                        .header("Authorization", "Bearer ${maybeRotated.accessToken}")
                        .build()
                }
                try {
                    val next = refreshAdapter.refresh(current)
                    tokenStore.save(next)
                    response.request.newBuilder()
                        .header("Authorization", "Bearer ${next.accessToken}")
                        .build()
                } catch (t: Throwable) {
                    tokenStore.clear()
                    null
                }
            }
        }
    }
}
