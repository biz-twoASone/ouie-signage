// android-tv/app/src/main/java/com/ouie/signage/SignageApp.kt
package com.ouie.signage

import android.app.Application
import com.google.firebase.crashlytics.FirebaseCrashlytics
import com.ouie.signage.auth.TokenSource
import com.ouie.signage.di.appModule
import org.koin.android.ext.android.inject
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin

class SignageApp : Application() {

    private val tokenStore: TokenSource by inject()

    override fun onCreate() {
        super.onCreate()
        startKoin {
            androidContext(this@SignageApp)
            modules(appModule)
        }
        val deviceId = tokenStore.loadSync()?.deviceId ?: "unpaired"
        FirebaseCrashlytics.getInstance().setUserId(deviceId)
    }
}
