package com.ouie.signage.net

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.ouie.signage.BuildConfig
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit

object ApiClient {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    /**
     * Shared OkHttp used by both pairing (no auth) and device (auth-required) retrofits.
     * Caller layers an Authenticator on top for device calls (Task 3.5).
     */
    fun baseHttpClient(): OkHttpClient.Builder {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY
                    else HttpLoggingInterceptor.Level.BASIC
            // Redact auth header even in BODY-level logs.
            redactHeader("Authorization")
        }
        return OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            .addInterceptor(logging)
    }

    fun retrofit(client: OkHttpClient): Retrofit =
        Retrofit.Builder()
            .baseUrl(BuildConfig.SUPABASE_URL.trimEnd('/') + "/functions/v1/")
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
}
