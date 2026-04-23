// android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt
package com.ouie.signage.di

import com.ouie.signage.auth.TokenSource
import com.ouie.signage.auth.TokenStore
import com.ouie.signage.coordinator.RunningCoordinator
import com.ouie.signage.errorbus.ErrorBus
import com.ouie.signage.fcm.FcmReceiptTracker
import com.ouie.signage.fcm.FcmTokenSource
import com.ouie.signage.fcm.SyncNowBroadcast
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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
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

    // App-wide error bus. Consumers report; HeartbeatScheduler drains.
    single { ErrorBus(capacity = 32) }

    // SyncNowBroadcast connects the FCM service and the coordinator.
    single { SyncNowBroadcast() }

    // FCM token cache — lives as long as the app process.
    single { FcmTokenSource(scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)) }
    single { FcmReceiptTracker() }

    // Pairing client — no auth, no skew tracking.
    single(qualifier = named("pairing")) { ApiClient.baseHttpClient().build() }
    single { ApiClient.retrofit(get(qualifier = named("pairing"))).create(PairingApi::class.java) }

    // Refresh client — no authenticator, to break the chicken-and-egg inside refresh.
    single(qualifier = named("device_refresh")) { ApiClient.baseHttpClient().build() }
    single { ApiClient.retrofit(get(qualifier = named("device_refresh"))).create(DeviceApi::class.java) }
    single<RefreshAdapter> { RetrofitRefreshAdapter(get()) }

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
            errorBus = get(),
            fcmTokenSource = get(),
            syncNow = get(),
            fcmReceiptTracker = get(),
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
