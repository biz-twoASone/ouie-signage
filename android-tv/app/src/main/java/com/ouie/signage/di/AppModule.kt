// android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt
package com.ouie.signage.di

import com.ouie.signage.auth.TokenSource
import com.ouie.signage.auth.TokenStore
import com.ouie.signage.coordinator.RunningCoordinator
import com.ouie.signage.heartbeat.ClockSkewTracker
import com.ouie.signage.net.ApiClient
import com.ouie.signage.net.AuthInterceptor
import com.ouie.signage.net.CacheStatusApi
import com.ouie.signage.net.ConfigApi
import com.ouie.signage.net.DateHeaderInterceptor
import com.ouie.signage.net.DeviceApi
import com.ouie.signage.net.HeartbeatApi
import com.ouie.signage.net.PairingApi
import com.ouie.signage.net.RefreshAdapter
import com.ouie.signage.net.RetrofitRefreshAdapter
import com.ouie.signage.net.TokenAuthenticator
import com.ouie.signage.pairing.PairingRepository
import com.ouie.signage.pairing.PairingViewModel
import com.ouie.signage.state.AppStateHolder
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import org.koin.android.ext.koin.androidContext
import org.koin.core.module.dsl.viewModel
import org.koin.core.qualifier.named
import org.koin.dsl.module

val appModule = module {
    single { AppStateHolder() }
    single<TokenSource> { TokenStore(androidContext()) }
    single { ClockSkewTracker() }
    single { Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false } }

    // Pairing client — no auth, no skew tracking (nothing to secure or time yet).
    single(qualifier = named("pairing")) { ApiClient.baseHttpClient().build() }
    single { ApiClient.retrofit(get(qualifier = named("pairing"))).create(PairingApi::class.java) }

    // Refresh client — no authenticator, to break the chicken-and-egg inside refresh.
    single(qualifier = named("device_refresh")) { ApiClient.baseHttpClient().build() }
    single { ApiClient.retrofit(get(qualifier = named("device_refresh"))).create(DeviceApi::class.java) }
    single<RefreshAdapter> { RetrofitRefreshAdapter(get()) }

    // Authed client — Bearer interceptor + TokenAuthenticator + Date-header capture.
    single(qualifier = named("authed")) {
        ApiClient.baseHttpClient()
            .addInterceptor(AuthInterceptor(get()))
            .addInterceptor(DateHeaderInterceptor(get()))
            .authenticator(TokenAuthenticator(get(), get()))
            .build()
    }
    single { ApiClient.retrofit(get<OkHttpClient>(qualifier = named("authed"))).create(ConfigApi::class.java) }
    single { ApiClient.retrofit(get<OkHttpClient>(qualifier = named("authed"))).create(HeartbeatApi::class.java) }
    single { ApiClient.retrofit(get<OkHttpClient>(qualifier = named("authed"))).create(CacheStatusApi::class.java) }

    // Downloader client — plain (no auth). R2 presigned URLs carry their own
    // SigV4 query params; adding a Bearer header makes R2 reject with 400.
    single(qualifier = named("downloader")) { ApiClient.baseHttpClient().build() }

    single {
        RunningCoordinator(
            context = androidContext(),
            downloaderHttpClient = get(qualifier = named("downloader")),
            configApi = get(),
            heartbeatApi = get(),
            cacheStatusApi = get(),
            skewTracker = get(),
            json = get(),
        )
    }

    single {
        PairingRepository(
            api = get(),
            proposedName = android.os.Build.MODEL ?: "Android TV",
        )
    }
    viewModel { PairingViewModel(repo = get(), tokenStore = get(), appState = get()) }
}
