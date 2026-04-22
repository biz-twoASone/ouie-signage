// android-tv/app/src/main/java/com/ouie/signage/di/AppModule.kt
package com.ouie.signage.di

import com.ouie.signage.state.AppStateHolder
import org.koin.dsl.module

val appModule = module {
    single { AppStateHolder() }
    // Phase 3 additions: TokenStore, OkHttpClient, Retrofit, PairingApi, DeviceApi, PairingRepository
}
