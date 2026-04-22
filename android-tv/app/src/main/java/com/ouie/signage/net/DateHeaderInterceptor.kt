// android-tv/app/src/main/java/com/ouie/signage/net/DateHeaderInterceptor.kt
package com.ouie.signage.net

import com.ouie.signage.heartbeat.ClockSkewTracker
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Feeds the ClockSkewTracker on every response. Installed on the `named("authed")`
 * client only; pairing traffic is pre-auth and not worth timing.
 */
class DateHeaderInterceptor(private val tracker: ClockSkewTracker) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val resp = chain.proceed(chain.request())
        resp.header("Date")?.let { tracker.record(it) }
        return resp
    }
}
