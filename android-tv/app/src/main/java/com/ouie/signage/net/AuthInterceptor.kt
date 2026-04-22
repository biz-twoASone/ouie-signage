// android-tv/app/src/main/java/com/ouie/signage/net/AuthInterceptor.kt
package com.ouie.signage.net

import com.ouie.signage.auth.TokenSource
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Appends `Authorization: Bearer <accessToken>` on every outbound request iff
 * the store currently has tokens. Missing tokens (= not yet paired) means the
 * request goes out unauthenticated — the server will respond appropriately.
 */
class AuthInterceptor(private val source: TokenSource) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val token = source.loadSync()?.accessToken
        val withAuth = if (token == null) req
                       else req.newBuilder().header("Authorization", "Bearer $token").build()
        return chain.proceed(withAuth)
    }
}
