// android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt
package com.ouie.signage.di

import com.ouie.signage.auth.TokenSource
import com.ouie.signage.auth.TokenStore
import com.ouie.signage.net.ApiClient
import com.ouie.signage.net.AuthInterceptor
import com.ouie.signage.net.DeviceApi
import com.ouie.signage.net.PairingApi
import com.ouie.signage.net.RefreshAdapter
import com.ouie.signage.net.RetrofitRefreshAdapter
import com.ouie.signage.net.TokenAuthenticator
import com.ouie.signage.pairing.PairingRepository
import com.ouie.signage.state.AppStateHolder
import okhttp3.OkHttpClient
import org.koin.android.ext.koin.androidContext
import org.koin.core.qualifier.named
import org.koin.dsl.module

val appModule = module {
    single { AppStateHolder() }

    // Token persistence
    single<TokenSource> { TokenStore(androidContext()) }

    // Unauthenticated client for pairing calls (no Authenticator, no interceptor)
    single(qualifier = named("pairing")) {
        ApiClient.baseHttpClient().build()
    }
    single {
        ApiClient.retrofit(get(qualifier = named("pairing")))
            .create(PairingApi::class.java)
    }

    // DeviceApi retrofit uses a separate client WITHOUT the authenticator —
    // needed to break a chicken-and-egg during the refresh call itself.
    single(qualifier = named("device_refresh")) {
        ApiClient.baseHttpClient().build()
    }
    single {
        ApiClient.retrofit(get(qualifier = named("device_refresh")))
            .create(DeviceApi::class.java)
    }
    single<RefreshAdapter> { RetrofitRefreshAdapter(get()) }

    // Authenticated client for everything else (used by 3b/3c endpoints; defined
    // here so the DI graph is complete for integration testing on real hardware).
    single(qualifier = named("authed")) {
        ApiClient.baseHttpClient()
            .addInterceptor(AuthInterceptor(get()))
            .authenticator(TokenAuthenticator(get(), get()))
            .build()
    }

    single {
        PairingRepository(
            api = get(),
            proposedName = android.os.Build.MODEL ?: "Android TV",
        )
    }
}
